import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import { looksDestructive, looksSensitive } from "./auto-approve.ts";
import type {
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
} from "./contracts.ts";
import {
  approvalDeadlineNs,
  beginToolCall,
  finishToolCall,
  recordApprovalOutcome,
  toolArgumentByteLimit,
  type ApplicationToolTurnControl,
  type ToolCallBudget,
} from "./tool-turn-control.ts";

const DESTINATION = "local-vm" as const;
const HMAC_DOMAIN = "agent-harbor/local-vm-tool-approval/v1";
const MAX_ARGUMENT_BYTES = 256 * 1024;
const MAX_ARGUMENT_DEPTH = 32;
const MAX_ARGUMENT_NODES = 16_384;
const MAX_CALL_ID_BYTES = 256;
const MAX_PENDING_APPROVALS = 32;
const MAX_CONCURRENT_CALLS = 32;
const MAX_SEEN_CALLS = 256;
const MAX_SUMMARY_BYTES = 768;
const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60_000;
const MAX_APPROVAL_TIMEOUT_MS = 15 * 60_000;
const SAFE_CALL_ID = /^[\x21-\x7e]+$/;
const SAFE_HMAC = /^[0-9a-f]{64}$/;
const PROTECTED_INPUT = /(?:api.?key|authorization|cookie|credential|password|passcode|one.?time|\botp\b|\bmfa\b|secret|token|card.?number|\bcvv\b|\bssn\b)/i;
const PROTECTED_VALUE = /(?:\bbearer\s+[a-z0-9._~+/=-]+|\bsk-[a-z0-9_-]+|\bgh[pousr]_[a-z0-9]+|\bAKIA[A-Z0-9]{12,}|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/i;
const TEXT_ENTRY_TOOL = /(?:^|[_-])(?:fill|input|paste|type|write)(?:$|[_-])/i;
// Effect words that make a call high-impact, matched with word boundaries and
// kept narrow. Broad words like "account"/"message" caused false positives that
// blocked ordinary reversible actions; genuinely destructive or sensitive
// argument content is still caught by looksDestructive/looksSensitive.
const HIGH_IMPACT = /\b(?:credential|delete|password|publish|purchase|secret|token)\b/i;
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type ToolApprovalFailureCode =
  | "aborted"
  | "approval_denied"
  | "approval_timeout"
  | "approval_unavailable"
  | "closed"
  | "conflicting_call_id"
  | "duplicate_call_id"
  | "invalid_arguments"
  | "invalid_call"
  | "mcp_failure"
  | "schema_rejected"
  | "too_many_calls"
  | "unknown_tool";

export class ToolApprovalError extends Error {
  readonly code: ToolApprovalFailureCode;

  constructor(code: ToolApprovalFailureCode, message: string) {
    super(message);
    this.name = "ToolApprovalError";
    this.code = code;
  }
}

/** Provider output is intentionally wider than ProviderToolCall here so the
 * safety boundary can reject malformed JSON and non-object argument values. */
export interface UntrustedProviderToolCall {
  id: unknown;
  name: unknown;
  arguments: unknown;
}

export interface ToolApprovalChallenge {
  readonly requestId: string;
  readonly turnId: string;
  readonly destination: typeof DESTINATION;
  readonly destinationId: string;
  readonly tool: string;
  readonly callIdHash: string;
  readonly argumentsHash: string;
  readonly toolDefinitionHash: string;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly binding: string;
}

export interface ToolApprovalDecision {
  readonly challenge: ToolApprovalChallenge;
  readonly behavior: "allow" | "deny";
}

export type ToolApprovalEvent =
  | {
      readonly type: "request.opened";
      readonly requestId: string;
      readonly requestType: "permission";
      readonly tool: string;
      readonly summary: string;
      readonly choices: readonly ["Allow", "Deny"];
      readonly consequential: boolean;
      readonly challenge: ToolApprovalChallenge;
    }
  | {
      readonly type: "request.resolved";
      readonly requestId: string;
      readonly behavior: "allow" | "deny";
      readonly source: "application" | "system";
      readonly reason: "approved" | "denied" | "invalid" | "timeout" | "unavailable" | "aborted" | "closed";
    };

export interface ToolApprovalAuditRecord {
  readonly requestId: string;
  readonly turnId: string;
  readonly destination: typeof DESTINATION;
  readonly tool: string;
  readonly callIdHash: string;
  readonly argumentsHash: string;
  readonly outcome: "allow" | "deny";
  readonly reason: "approved" | "denied" | "invalid" | "timeout" | "unavailable" | "aborted" | "closed";
}

/** Opaque application-owned capability. It can only be created by
 * createApplicationToolApprovalChannel, never by provider output. */
export interface ApplicationToolApprovalChannel {
  readonly kind: "application-tool-approval";
}

export interface ApplicationToolApprovalDecisions {
  /** Returns false for stale, replayed, cross-session, or unknown decisions. */
  resolve(decision: ToolApprovalDecision): boolean;
}

interface ApplicationChannelState {
  emit: (event: ToolApprovalEvent) => void;
  pending: Map<string, (decision: ToolApprovalDecision) => boolean>;
}

const applicationChannels = new WeakMap<ApplicationToolApprovalChannel, ApplicationChannelState>();

export function createApplicationToolApprovalChannel(
  emit: (event: ToolApprovalEvent) => void,
): { channel: ApplicationToolApprovalChannel; decisions: ApplicationToolApprovalDecisions } {
  if (typeof emit !== "function") throw new TypeError("An application approval event handler is required");
  const channel = Object.freeze({ kind: "application-tool-approval" as const });
  const state: ApplicationChannelState = { emit, pending: new Map() };
  applicationChannels.set(channel, state);
  return Object.freeze({
    channel,
    decisions: Object.freeze({
      resolve(decision: ToolApprovalDecision): boolean {
        let requestId: unknown;
        try {
          requestId = decision?.challenge?.requestId;
        } catch {
          return false;
        }
        if (typeof requestId !== "string") return false;
        const resolver = state.pending.get(requestId);
        return resolver ? resolver(decision) : false;
      },
    }),
  });
}

export interface ToolApprovalSessionOptions {
  turnId: string;
  approval?: ApplicationToolApprovalChannel;
  approvalTimeoutMs?: number;
  signal?: AbortSignal;
  /** Application-owned operational limits. Provider output never receives or
   * constructs this capability; omitting it preserves the Story 4 gate. */
  turnControl?: ApplicationToolTurnControl;
}

export interface ToolApprovalLifecycleResources {
  activeCalls: number;
  listeners: number;
  pending: number;
  timers: number;
  seenCalls: number;
}

/** This is the only handle provider-facing orchestration receives. It has no
 * method that can resolve or manufacture an approval decision. */
export interface ApprovedToolRequests {
  execute(call: UntrustedProviderToolCall): Promise<ProviderToolResult>;
  close(): void;
  lifecycleResources(): ToolApprovalLifecycleResources;
  auditRecords(): readonly ToolApprovalAuditRecord[];
}

interface TrustedTool {
  canonicalDefinition: string;
  validate: ValidateFunction;
}

interface PendingApproval {
  challenge: ToolApprovalChallenge;
  deadlineNs: bigint;
  timer: ReturnType<typeof setTimeout>;
  finish: (result: ApprovalResult) => void;
}

interface ApprovalResult {
  behavior: "allow" | "deny";
  reason: "approved" | "denied" | "invalid" | "timeout" | "unavailable" | "aborted" | "closed";
  source: "application" | "system";
  deadlineNs?: bigint;
}

interface NormalizedCall {
  call: ProviderToolCall;
  canonicalArguments: string;
  argumentsHash: string;
  callIdHash: string;
}

interface UntrustedCallFields {
  id: unknown;
  name: unknown;
  arguments: unknown;
}

function keyedDigest(key: Buffer, purpose: string, ...values: string[]): string {
  const hmac = createHmac("sha256", key);
  for (const value of [HMAC_DOMAIN, purpose, ...values]) {
    const encoded = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(encoded.length);
    hmac.update(length);
    hmac.update(encoded);
  }
  return hmac.digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertBoundedIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    byteLength(value) > MAX_CALL_ID_BYTES ||
    !SAFE_CALL_ID.test(value)
  ) {
    throw new ToolApprovalError("invalid_call", `${label} is invalid`);
  }
}

interface CloneBudget {
  bytes: number;
  nodes: number;
  maxBytes: number;
}

function addBudget(budget: CloneBudget, encoded: string): void {
  budget.bytes += byteLength(encoded);
  if (budget.bytes > budget.maxBytes) {
    throw new ToolApprovalError("invalid_arguments", "Tool arguments exceed the safety limit");
  }
}

function cloneJson(value: unknown, budget: CloneBudget, depth: number, ancestors: WeakSet<object>): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_ARGUMENT_NODES || depth > MAX_ARGUMENT_DEPTH) {
    throw new ToolApprovalError("invalid_arguments", "Tool arguments exceed the structural safety limit");
  }
  if (value === null || typeof value === "boolean") {
    addBudget(budget, value === null ? "null" : String(value));
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ToolApprovalError("invalid_arguments", "Tool arguments must be JSON values");
    addBudget(budget, String(value));
    return value;
  }
  if (typeof value === "string") {
    addBudget(budget, JSON.stringify(value));
    return value;
  }
  if (Array.isArray(value)) {
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype || ancestors.has(value)) {
        throw new ToolApprovalError("invalid_arguments", "Tool argument arrays must be plain and acyclic");
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.some((key) => typeof key !== "string") ||
        keys.length !== value.length + 1 ||
        !keys.includes("length")
      ) {
        throw new ToolApprovalError("invalid_arguments", "Tool argument arrays must be dense JSON arrays");
      }
      ancestors.add(value);
      const copy: unknown[] = [];
      try {
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new ToolApprovalError("invalid_arguments", "Tool argument arrays must contain plain values");
          }
          copy.push(cloneJson(descriptor.value, budget, depth + 1, ancestors));
        }
      } finally {
        ancestors.delete(value);
      }
      addBudget(budget, "[]");
      return Object.freeze(copy);
    } catch (error) {
      if (error instanceof ToolApprovalError) throw error;
      throw new ToolApprovalError("invalid_arguments", "Tool argument array is invalid");
    }
  }
  if (typeof value !== "object" || value === null) {
    throw new ToolApprovalError("invalid_arguments", "Tool arguments must be JSON values");
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ToolApprovalError("invalid_arguments", "Tool arguments must be plain JSON objects");
    }
    if (ancestors.has(value)) {
      throw new ToolApprovalError("invalid_arguments", "Tool arguments must be acyclic JSON values");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      throw new ToolApprovalError("invalid_arguments", "Tool arguments must not contain symbol properties");
    }
    const copy: Record<string, unknown> = {};
    ancestors.add(value);
    try {
      for (const key of (keys as string[]).sort()) {
        if (POLLUTION_KEYS.has(key)) {
          throw new ToolApprovalError("invalid_arguments", "Tool arguments contain a prohibited property name");
        }
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new ToolApprovalError("invalid_arguments", "Tool arguments must contain only plain enumerable values");
        }
        addBudget(budget, JSON.stringify(key));
        const cloned = cloneJson(descriptor.value, budget, depth + 1, ancestors);
        Object.defineProperty(copy, key, { value: cloned, enumerable: true, configurable: false, writable: false });
      }
    } finally {
      ancestors.delete(value);
    }
    addBudget(budget, "{}");
    return Object.freeze(copy);
  } catch (error) {
    if (error instanceof ToolApprovalError) throw error;
    throw new ToolApprovalError("invalid_arguments", "Tool argument object is invalid");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function untrustedCallFields(untrusted: UntrustedProviderToolCall): UntrustedCallFields {
  try {
    if (!untrusted || typeof untrusted !== "object") {
      throw new ToolApprovalError("invalid_call", "Tool call is invalid");
    }
    const prototype = Object.getPrototypeOf(untrusted);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ToolApprovalError("invalid_call", "Tool call must be a plain object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(untrusted);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 3 ||
      !keys.every((key) => typeof key === "string" && ["id", "name", "arguments"].includes(key))
    ) {
      throw new ToolApprovalError("invalid_call", "Tool call has an invalid structure");
    }
    const read = (key: "id" | "name" | "arguments"): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new ToolApprovalError("invalid_call", "Tool call must contain plain enumerable values");
      }
      return descriptor.value;
    };
    return { id: read("id"), name: read("name"), arguments: read("arguments") };
  } catch (error) {
    if (error instanceof ToolApprovalError) throw error;
    throw new ToolApprovalError("invalid_call", "Tool call is invalid");
  }
}

function normalizeCall(
  untrusted: UntrustedProviderToolCall,
  key: Buffer,
  maxArgumentBytes = MAX_ARGUMENT_BYTES,
): NormalizedCall {
  const fields = untrustedCallFields(untrusted);
  assertBoundedIdentifier(fields.id, "Tool call ID");
  assertBoundedIdentifier(fields.name, "Tool name");
  let parsed = fields.arguments;
  if (typeof parsed === "string") {
    if (byteLength(parsed) > maxArgumentBytes) {
      throw new ToolApprovalError("invalid_arguments", "Tool arguments exceed the safety limit");
    }
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new ToolApprovalError("invalid_arguments", "Tool arguments are not valid JSON");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ToolApprovalError("invalid_arguments", "Tool arguments must be a JSON object");
  }
  let cloned: Record<string, unknown>;
  try {
    cloned = cloneJson(parsed, { bytes: 0, nodes: 0, maxBytes: maxArgumentBytes }, 0, new WeakSet()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ToolApprovalError) throw error;
    throw new ToolApprovalError("invalid_arguments", "Tool arguments are invalid");
  }
  const canonicalArguments = stableJson(cloned);
  if (byteLength(canonicalArguments) > maxArgumentBytes) {
    throw new ToolApprovalError("invalid_arguments", "Tool arguments exceed the safety limit");
  }
  return {
    call: Object.freeze({ id: fields.id, name: fields.name, arguments: cloned }),
    canonicalArguments,
    argumentsHash: keyedDigest(key, "arguments", canonicalArguments),
    callIdHash: keyedDigest(key, "call-id", fields.id),
  };
}

function boundedSummary(tool: string, argumentsValue: Record<string, unknown>): string {
  const entries = Object.entries(argumentsValue).sort(([left], [right]) => left.localeCompare(right)).slice(0, 20);
  const textEntryTool = TEXT_ENTRY_TOOL.test(tool);
  const protectedInput = entries.some(([field, value]) =>
    PROTECTED_INPUT.test(field) ||
    (typeof value === "string" && (PROTECTED_INPUT.test(value) || PROTECTED_VALUE.test(value)))
  );
  const safeValue = (value: unknown, sensitive: boolean, depth = 0): unknown => {
    if (
      typeof value === "string" &&
      (sensitive || PROTECTED_INPUT.test(value) || PROTECTED_VALUE.test(value))
    ) return "[redacted]";
    if (typeof value === "string") {
      return value.replace(/[\u0000-\u001f\u007f]/g, " ").normalize("NFC").slice(0, 120);
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (depth >= 2) return "[nested value]";
    if (Array.isArray(value)) return value.slice(0, 5).map((item) => safeValue(item, sensitive, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 10).map(([key, item]) => [
        key.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64),
        safeValue(item, sensitive || PROTECTED_INPUT.test(key), depth + 1),
      ]));
    }
    return "[unsupported value]";
  };
  const details = Object.fromEntries(entries.map(([field, value]) => {
    const key = field.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64);
    const sensitive = PROTECTED_INPUT.test(field) ||
      (typeof value === "string" && (textEntryTool || protectedInput || PROTECTED_VALUE.test(value)));
    return [key, safeValue(value, sensitive)];
  }));
  let summary = entries.length
    ? `Requested details: ${JSON.stringify(details)}`
    : "Requested details: no arguments";
  while (byteLength(summary) > MAX_SUMMARY_BYTES) summary = summary.slice(0, -1);
  return summary;
}

function challengeBinding(key: Buffer, challenge: Omit<ToolApprovalChallenge, "binding">): string {
  return keyedDigest(
    key,
    "approval-binding",
    challenge.requestId,
    challenge.turnId,
    challenge.destination,
    challenge.destinationId,
    challenge.tool,
    challenge.callIdHash,
    challenge.argumentsHash,
    challenge.toolDefinitionHash,
    challenge.attemptId,
    String(challenge.expiresAt),
  );
}

function safeEqual(left: unknown, right: string): boolean {
  if (
    typeof left !== "string" ||
    left.length !== 64 ||
    right.length !== 64 ||
    !SAFE_HMAC.test(left) ||
    !SAFE_HMAC.test(right)
  ) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function exactChallenge(actual: unknown, expected: ToolApprovalChallenge, key: Buffer): boolean {
  if (!actual || typeof actual !== "object") return false;
  try {
    const challenge = actual as ToolApprovalChallenge;
    if (
      challenge.requestId !== expected.requestId ||
      challenge.turnId !== expected.turnId ||
      challenge.destination !== expected.destination ||
      challenge.destinationId !== expected.destinationId ||
      challenge.tool !== expected.tool ||
      challenge.callIdHash !== expected.callIdHash ||
      challenge.argumentsHash !== expected.argumentsHash ||
      challenge.toolDefinitionHash !== expected.toolDefinitionHash ||
      challenge.attemptId !== expected.attemptId ||
      challenge.expiresAt !== expected.expiresAt
    ) return false;
    const binding = challengeBinding(key, expected);
    return safeEqual(challenge.binding, binding);
  } catch {
    return false;
  }
}

function consequential(tool: string, canonicalArguments: string): boolean {
  return looksDestructive(tool) || looksSensitive(tool) || HIGH_IMPACT.test(tool) ||
    looksDestructive(canonicalArguments) || looksSensitive(canonicalArguments) || HIGH_IMPACT.test(canonicalArguments);
}

function frozenChallenge(value: ToolApprovalChallenge): ToolApprovalChallenge {
  return Object.freeze(value);
}

export function createApprovedToolRequests(
  discoveredTools: readonly ProviderToolDefinition[],
  executeTool: (call: ProviderToolCall, budget?: ToolCallBudget) => Promise<ProviderToolResult>,
  options: ToolApprovalSessionOptions,
): ApprovedToolRequests {
  assertBoundedIdentifier(options.turnId, "Turn ID");
  const timeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_APPROVAL_TIMEOUT_MS) {
    throw new ToolApprovalError("invalid_call", "Approval timeout is outside the safety limit");
  }
  const channelState = options.approval ? applicationChannels.get(options.approval) : undefined;
  const ajv = new Ajv2020({
    allErrors: false,
    coerceTypes: false,
    logger: false,
    ownProperties: true,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
    validateFormats: true,
    formats: {
      double: { type: "number", validate: (value: number) => Number.isFinite(value) },
      uint32: {
        type: "number",
        validate: (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff,
      },
      uint64: {
        type: "number",
        validate: (value: number) => Number.isSafeInteger(value) && value >= 0,
      },
    },
  });
  const trustedTools = new Map<string, TrustedTool>();
  for (const definition of discoveredTools) {
    if (trustedTools.has(definition.name)) {
      throw new ToolApprovalError("invalid_call", "Trusted MCP discovery contained duplicate tools");
    }
    let validate: ValidateFunction;
    try {
      validate = ajv.compile(definition.inputSchema);
    } catch {
      throw new ToolApprovalError("invalid_call", "Trusted MCP discovery contained an unsupported schema");
    }
    trustedTools.set(definition.name, {
      canonicalDefinition: stableJson({ name: definition.name, inputSchema: definition.inputSchema }),
      validate,
    });
  }

  const bindingKey = randomBytes(32);
  const destinationId = randomUUID();
  const pending = new Map<string, PendingApproval>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const seenCalls = new Map<string, string>();
  const audit: ToolApprovalAuditRecord[] = [];
  let activeCalls = 0;
  let closed = false;

  const emitResolved = (request: PendingApproval, result: ApprovalResult): void => {
    const record = Object.freeze({
      requestId: request.challenge.requestId,
      turnId: options.turnId,
      destination: DESTINATION,
      tool: request.challenge.tool,
      callIdHash: request.challenge.callIdHash,
      argumentsHash: request.challenge.argumentsHash,
      outcome: result.behavior,
      reason: result.reason,
    });
    audit.push(record);
    try {
      channelState?.emit(Object.freeze({
        type: "request.resolved",
        requestId: request.challenge.requestId,
        behavior: result.behavior,
        source: result.source,
        reason: result.reason,
      }));
    } catch {
      // Resolution reporting cannot revive or change an already consumed call.
    }
  };

  const settle = (requestId: string, result: ApprovalResult): boolean => {
    const request = pending.get(requestId);
    if (!request) return false;
    pending.delete(requestId);
    channelState?.pending.delete(requestId);
    clearTimeout(request.timer);
    timers.delete(request.timer);
    request.finish(result);
    emitResolved(request, result);
    return true;
  };

  const closeWith = (reason: "aborted" | "closed"): void => {
    if (closed) return;
    closed = true;
    for (const requestId of [...pending.keys()]) {
      settle(requestId, { behavior: "deny", reason, source: "system" });
    }
    options.signal?.removeEventListener("abort", onAbort);
    bindingKey.fill(0);
    seenCalls.clear();
    trustedTools.clear();
    try {
      ajv.removeSchema();
    } catch {
      // Schema disposal is best-effort after all execution authority is gone.
    }
  };
  const onAbort = (): void => closeWith("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  const freshRequestId = (): string => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = randomUUID();
      if (!pending.has(candidate) && !channelState?.pending.has(candidate)) return candidate;
    }
    throw new ToolApprovalError("too_many_calls", "Could not allocate a unique approval request");
  };

  const awaitApproval = (
    normalized: NormalizedCall,
    trusted: TrustedTool,
    budget?: ToolCallBudget,
  ): Promise<ApprovalResult> => {
    if (closed) {
      return Promise.resolve({ behavior: "deny", reason: options.signal?.aborted ? "aborted" : "closed", source: "system" });
    }
    if (!channelState) {
      return Promise.resolve({ behavior: "deny", reason: "unavailable", source: "system" });
    }
    if (pending.size >= MAX_PENDING_APPROVALS) {
      throw new ToolApprovalError("too_many_calls", "Too many tool approvals are pending");
    }
    const deadlineNs = options.turnControl && budget
      ? approvalDeadlineNs(options.turnControl, budget, timeoutMs)
      : process.hrtime.bigint() + BigInt(Math.ceil(timeoutMs * 1_000_000));
    const displayRemainingMs = Math.max(
      1,
      Number((deadlineNs - process.hrtime.bigint() + 999_999n) / 1_000_000n),
    );
    const unsigned = {
      requestId: freshRequestId(),
      turnId: options.turnId,
      destination: DESTINATION,
      destinationId,
      tool: normalized.call.name,
      callIdHash: normalized.callIdHash,
      argumentsHash: normalized.argumentsHash,
      toolDefinitionHash: keyedDigest(bindingKey, "tool-definition", trusted.canonicalDefinition),
      attemptId: randomUUID(),
      expiresAt: Date.now() + displayRemainingMs,
    } as const;
    const challenge = frozenChallenge({
      ...unsigned,
      binding: challengeBinding(bindingKey, unsigned),
    });
    return new Promise((finish) => {
      let request: PendingApproval;
      const expire = (): void => {
        timers.delete(request.timer);
        const remainingNs = deadlineNs - process.hrtime.bigint();
        if (remainingNs > 0n) {
          const remainingMs = Math.max(1, Number((remainingNs + 999_999n) / 1_000_000n));
          request.timer = setTimeout(expire, remainingMs);
          request.timer.unref?.();
          timers.add(request.timer);
          return;
        }
        settle(challenge.requestId, { behavior: "deny", reason: "timeout", source: "system" });
      };
      const timer = setTimeout(expire, displayRemainingMs);
      timer.unref?.();
      timers.add(timer);
      request = { challenge, deadlineNs, timer, finish };
      pending.set(challenge.requestId, request);
      channelState.pending.set(challenge.requestId, (decision) => {
        let behavior: unknown;
        let suppliedChallenge: unknown;
        try {
          behavior = decision?.behavior;
          suppliedChallenge = decision?.challenge;
        } catch {
          return settle(challenge.requestId, { behavior: "deny", reason: "invalid", source: "application" });
        }
        if (process.hrtime.bigint() >= request.deadlineNs) {
          return settle(challenge.requestId, { behavior: "deny", reason: "timeout", source: "system" });
        }
        if (
          (behavior !== "allow" && behavior !== "deny") ||
          !exactChallenge(suppliedChallenge, challenge, bindingKey)
        ) {
          return settle(challenge.requestId, { behavior: "deny", reason: "invalid", source: "application" });
        }
        return settle(challenge.requestId, {
          behavior,
          reason: behavior === "allow" ? "approved" : "denied",
          source: "application",
          ...(behavior === "allow" ? { deadlineNs: request.deadlineNs } : {}),
        });
      });
      try {
        channelState.emit(Object.freeze({
          type: "request.opened",
          requestId: challenge.requestId,
          requestType: "permission",
          tool: normalized.call.name,
          summary: boundedSummary(normalized.call.name, normalized.call.arguments),
          choices: Object.freeze(["Allow", "Deny"] as const),
          consequential: consequential(normalized.call.name, normalized.canonicalArguments),
          challenge,
        }));
      } catch {
        settle(challenge.requestId, { behavior: "deny", reason: "unavailable", source: "system" });
      }
    });
  };

  const executeOne = async (untrusted: UntrustedProviderToolCall): Promise<ProviderToolResult> => {
    const normalized = normalizeCall(
      untrusted,
      bindingKey,
      options.turnControl ? toolArgumentByteLimit(options.turnControl) : MAX_ARGUMENT_BYTES,
    );
    const identity = normalized.callIdHash;
    const fingerprint = keyedDigest(bindingKey, "call-fingerprint", normalized.call.name, normalized.argumentsHash);
    const previous = seenCalls.get(identity);
    if (previous !== undefined) {
      throw new ToolApprovalError(
        previous === fingerprint ? "duplicate_call_id" : "conflicting_call_id",
        previous === fingerprint ? "Tool call ID was already used" : "Tool call ID was reused with different content",
      );
    }
    if (seenCalls.size >= MAX_SEEN_CALLS) {
      throw new ToolApprovalError("too_many_calls", "Tool call identity limit was reached");
    }
    seenCalls.set(identity, fingerprint);

    const trusted = trustedTools.get(normalized.call.name);
    if (!trusted) throw new ToolApprovalError("unknown_tool", "Tool was not discovered from the Local VM MCP server");
    let schemaAccepted = false;
    try {
      schemaAccepted = trusted.validate(normalized.call.arguments) === true;
    } catch {
      schemaAccepted = false;
    } finally {
      trusted.validate.errors = null;
    }
    if (!schemaAccepted) {
      throw new ToolApprovalError("schema_rejected", "Tool arguments do not match the discovered schema");
    }

    const budget = options.turnControl
      ? beginToolCall(options.turnControl, normalized.call.name, normalized.canonicalArguments)
      : undefined;
    let finalOutcome: "success" | "denied" | "timeout" | "aborted" | "error" = "error";
    try {
      const approval = await awaitApproval(normalized, trusted, budget);
      if (options.turnControl && budget) {
        recordApprovalOutcome(
          options.turnControl,
          budget,
          approval.behavior === "allow"
            ? "allow"
            : approval.reason === "timeout"
              ? "timeout"
              : approval.reason === "aborted" || approval.reason === "closed"
                ? "aborted"
                : "deny",
        );
      }
      if (approval.behavior !== "allow") {
        finalOutcome = approval.reason === "timeout"
          ? "timeout"
          : approval.reason === "aborted" || approval.reason === "closed"
            ? "aborted"
            : "denied";
        const code = approval.reason === "timeout"
          ? "approval_timeout"
          : approval.reason === "unavailable"
            ? "approval_unavailable"
            : approval.reason === "aborted"
              ? "aborted"
              : approval.reason === "closed"
                ? "closed"
                : "approval_denied";
        throw new ToolApprovalError(code, "Tool execution was not approved");
      }
      if (closed || options.signal?.aborted) {
        finalOutcome = "aborted";
        throw new ToolApprovalError(options.signal?.aborted ? "aborted" : "closed", "Tool execution turn is closed");
      }
      if (approval.deadlineNs === undefined || process.hrtime.bigint() >= approval.deadlineNs) {
        finalOutcome = "timeout";
        throw new ToolApprovalError("approval_timeout", "Tool approval expired before execution began");
      }
      const result = await executeTool(normalized.call, budget);
      finalOutcome = "success";
      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        finalOutcome = "aborted";
        throw new ToolApprovalError("aborted", "Tool execution turn is closed");
      }
      if (error instanceof ToolApprovalError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "closed") {
        finalOutcome = "aborted";
        throw new ToolApprovalError("closed", "Tool execution turn is closed");
      }
      throw new ToolApprovalError("mcp_failure", "Approved Local VM tool execution failed");
    } finally {
      if (options.turnControl && budget) {
        finishToolCall(options.turnControl, budget, finalOutcome, finalOutcome === "success");
      }
    }
  };

  const requests: ApprovedToolRequests = {
    async execute(untrusted: UntrustedProviderToolCall): Promise<ProviderToolResult> {
      if (closed) {
        throw new ToolApprovalError(options.signal?.aborted ? "aborted" : "closed", "Tool execution turn is closed");
      }
      if (activeCalls >= MAX_CONCURRENT_CALLS) {
        throw new ToolApprovalError("too_many_calls", "Too many tool calls are active");
      }
      activeCalls += 1;
      try {
        return await executeOne(untrusted);
      } finally {
        activeCalls -= 1;
      }
    },
    close(): void {
      closeWith(options.signal?.aborted ? "aborted" : "closed");
    },
    lifecycleResources(): ToolApprovalLifecycleResources {
      return {
        activeCalls,
        listeners: closed || !options.signal ? 0 : 1,
        pending: pending.size,
        timers: timers.size,
        seenCalls: seenCalls.size,
      };
    },
    auditRecords(): readonly ToolApprovalAuditRecord[] {
      return Object.freeze([...audit]);
    },
  };
  return Object.freeze(requests);
}
