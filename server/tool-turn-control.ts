import { createHmac, randomBytes } from "node:crypto";

const HARD_MAX_ARGUMENT_BYTES = 256 * 1024;
const HARD_MAX_RESULT_BYTES = 2 * 1024 * 1024;
const HARD_MAX_AGGREGATE_BYTES = 16 * 1024 * 1024;
const HARD_MAX_TOOL_CALLS = 256;
const HARD_MAX_MCP_REQUESTS = 512;
const HARD_MAX_EVENTS = 256;

export interface LocalVmToolTurnLimits {
  readonly turnTimeoutMs: number;
  readonly toolCallTimeoutMs: number;
  readonly approvalWaitTimeoutMs: number;
  readonly mcpRequestTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
  readonly maxToolCalls: number;
  readonly maxRepeatedCalls: number;
  readonly maxArgumentBytes: number;
  readonly maxResultBytes: number;
  readonly maxAggregateArgumentBytes: number;
  readonly maxAggregateResultBytes: number;
  readonly maxMcpRequests: number;
  readonly maxObservabilityEvents: number;
}

export const DEFAULT_LOCAL_VM_TOOL_TURN_LIMITS: LocalVmToolTurnLimits = Object.freeze({
  turnTimeoutMs: 2 * 60_000,
  toolCallTimeoutMs: 45_000,
  approvalWaitTimeoutMs: 30_000,
  mcpRequestTimeoutMs: 10_000,
  toolExecutionTimeoutMs: 15_000,
  maxToolCalls: 32,
  maxRepeatedCalls: 3,
  maxArgumentBytes: HARD_MAX_ARGUMENT_BYTES,
  maxResultBytes: HARD_MAX_RESULT_BYTES,
  maxAggregateArgumentBytes: 1024 * 1024,
  maxAggregateResultBytes: 8 * 1024 * 1024,
  maxMcpRequests: 64,
  maxObservabilityEvents: 128,
});

export type TurnLimitName =
  | "aggregate_arguments"
  | "aggregate_results"
  | "approval_wait"
  | "argument_bytes"
  | "elapsed_turn"
  | "mcp_execution"
  | "mcp_requests"
  | "observability_events"
  | "repeated_calls"
  | "result_bytes"
  | "tool_call_elapsed"
  | "tool_calls";

export type TurnObservationType =
  | "approval.outcome"
  | "cleanup.outcome"
  | "execution.outcome"
  | "lease.lifecycle"
  | "limit.decision"
  | "preview.refresh_requested"
  | "state.transition";

export interface TurnObservationCounts {
  readonly toolCalls: number;
  readonly mcpRequests: number;
  readonly argumentBytes: number;
  readonly resultBytes: number;
  readonly activeCalls: number;
}

/** Deliberately content-free. No binding IDs, call IDs, tool names, argument
 * values, results, provider bodies, MCP payloads, argv, or environment data. */
export interface TurnObservationEvent {
  readonly sequence: number;
  readonly type: TurnObservationType;
  readonly elapsedMs: number;
  readonly counts: TurnObservationCounts;
  readonly state?: "acquiring" | "active" | "cancelling" | "cleaning" | "closed";
  readonly lease?: "acquired" | "contended" | "expired" | "mismatch" | "released" | "reused";
  readonly decision?: "allow" | "deny";
  readonly outcome?: "aborted" | "denied" | "error" | "failure" | "success" | "timeout";
  readonly limit?: TurnLimitName;
  readonly value?: number;
  readonly ceiling?: number;
}

type TurnFailureCode =
  | "aborted"
  | "aggregate_limit"
  | "argument_limit"
  | "closed"
  | "mcp_limit"
  | "observability_failure"
  | "repeat_limit"
  | "result_limit"
  | "timeout"
  | "tool_call_limit";

export class ToolTurnLimitError extends Error {
  readonly code: TurnFailureCode;

  constructor(code: TurnFailureCode, message: string) {
    super(message);
    this.name = "ToolTurnLimitError";
    this.code = code;
  }
}

/** Opaque control received by internal MCP and approval layers only. */
export interface ApplicationToolTurnControl {
  readonly kind: "application-tool-turn-control";
}

/** Opaque one-call budget. It cannot be forged or reused across controls. */
export interface ToolCallBudget {
  readonly kind: "local-vm-tool-call-budget";
}

interface CallState {
  owner: ControlState;
  startedNs: bigint;
  deadlineNs: bigint;
  active: boolean;
  resultBytes: number;
}

interface ControlState {
  control: ApplicationToolTurnControl;
  controller: AbortController;
  startedNs: bigint;
  deadlineNs: bigint;
  limits: LocalVmToolTurnLimits;
  observe?: (event: TurnObservationEvent) => void;
  externalSignal?: AbortSignal;
  externalAbort?: () => void;
  timer: ReturnType<typeof setTimeout>;
  repeatKey: Buffer;
  repeats: Map<string, number>;
  activeCalls: number;
  toolCalls: number;
  mcpRequests: number;
  argumentBytes: number;
  resultBytes: number;
  events: number;
  closed: boolean;
  failure: ToolTurnLimitError | null;
  observationDisabled: boolean;
}

const controls = new WeakMap<ApplicationToolTurnControl, ControlState>();
const callBudgets = new WeakMap<ToolCallBudget, CallState>();

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function toNs(ms: number): bigint {
  return BigInt(Math.ceil(ms * 1_000_000));
}

function remainingMs(deadlineNs: bigint): number {
  const remaining = deadlineNs - nowNs();
  return remaining <= 0n ? 0 : Math.max(1, Math.ceil(Number(remaining) / 1_000_000));
}

function finiteInteger(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new ToolTurnLimitError("closed", `${name} is outside the safety limit`);
  }
  return value as number;
}

function resolveLimits(input: Partial<LocalVmToolTurnLimits> = {}): LocalVmToolTurnLimits {
  const merged = { ...DEFAULT_LOCAL_VM_TOOL_TURN_LIMITS, ...input };
  const limits: LocalVmToolTurnLimits = {
    turnTimeoutMs: finiteInteger(merged.turnTimeoutMs, "Turn timeout", 10 * 60_000),
    toolCallTimeoutMs: finiteInteger(merged.toolCallTimeoutMs, "Tool-call timeout", 5 * 60_000),
    approvalWaitTimeoutMs: finiteInteger(merged.approvalWaitTimeoutMs, "Approval timeout", 5 * 60_000),
    mcpRequestTimeoutMs: finiteInteger(merged.mcpRequestTimeoutMs, "MCP timeout", 5 * 60_000),
    toolExecutionTimeoutMs: finiteInteger(merged.toolExecutionTimeoutMs, "Tool execution timeout", 5 * 60_000),
    maxToolCalls: finiteInteger(merged.maxToolCalls, "Tool-call count", HARD_MAX_TOOL_CALLS),
    maxRepeatedCalls: finiteInteger(merged.maxRepeatedCalls, "Repeated-call count", HARD_MAX_TOOL_CALLS),
    maxArgumentBytes: finiteInteger(merged.maxArgumentBytes, "Argument bytes", HARD_MAX_ARGUMENT_BYTES),
    maxResultBytes: finiteInteger(merged.maxResultBytes, "Result bytes", HARD_MAX_RESULT_BYTES),
    maxAggregateArgumentBytes: finiteInteger(
      merged.maxAggregateArgumentBytes,
      "Aggregate argument bytes",
      HARD_MAX_AGGREGATE_BYTES,
    ),
    maxAggregateResultBytes: finiteInteger(
      merged.maxAggregateResultBytes,
      "Aggregate result bytes",
      HARD_MAX_AGGREGATE_BYTES,
    ),
    maxMcpRequests: finiteInteger(merged.maxMcpRequests, "MCP request count", HARD_MAX_MCP_REQUESTS),
    maxObservabilityEvents: finiteInteger(
      merged.maxObservabilityEvents,
      "Observability event count",
      HARD_MAX_EVENTS,
    ),
  };
  if (
    limits.maxRepeatedCalls > limits.maxToolCalls ||
    limits.maxAggregateArgumentBytes < limits.maxArgumentBytes ||
    limits.maxAggregateResultBytes < limits.maxResultBytes
  ) {
    throw new ToolTurnLimitError("closed", "Aggregate and repeated-call limits are inconsistent");
  }
  return Object.freeze(limits);
}

function stateFor(control: ApplicationToolTurnControl): ControlState {
  const state = controls.get(control);
  if (!state || state.closed) throw state?.failure ?? new ToolTurnLimitError("closed", "Local VM tool turn is closed");
  if (state.controller.signal.aborted) {
    throw state.failure ?? new ToolTurnLimitError("aborted", "Local VM tool turn was cancelled");
  }
  if (nowNs() >= state.deadlineNs) {
    return limitDenied(
      state,
      "timeout",
      "elapsed_turn",
      state.limits.turnTimeoutMs,
      state.limits.turnTimeoutMs,
    );
  }
  return state;
}

function frozenCounts(state: ControlState): TurnObservationCounts {
  return Object.freeze({
    toolCalls: state.toolCalls,
    mcpRequests: state.mcpRequests,
    argumentBytes: state.argumentBytes,
    resultBytes: state.resultBytes,
    activeCalls: state.activeCalls,
  });
}

function safeNumber(value: number): number {
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
}

const OBSERVATION_LIMITS = new Set<TurnLimitName>([
  "aggregate_arguments", "aggregate_results", "approval_wait", "argument_bytes", "elapsed_turn",
  "mcp_execution", "mcp_requests", "observability_events", "repeated_calls", "result_bytes",
  "tool_call_elapsed", "tool_calls",
]);

function observationFields(
  event: Omit<TurnObservationEvent, "sequence" | "elapsedMs" | "counts">,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!event || typeof event !== "object") throw new Error("invalid");
  const prototype = Object.getPrototypeOf(event);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid");
  const descriptors = Object.getOwnPropertyDescriptors(event);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== allowed.length ||
    !keys.every((key) => typeof key === "string" && allowed.includes(key))
  ) throw new Error("invalid");
  const values: Record<string, unknown> = {};
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("invalid");
    values[key] = descriptor.value;
  }
  return values;
}

function sanitizedObservation(
  event: Omit<TurnObservationEvent, "sequence" | "elapsedMs" | "counts">,
): Omit<TurnObservationEvent, "sequence" | "elapsedMs" | "counts"> {
  const typeDescriptor = event && typeof event === "object"
    ? Object.getOwnPropertyDescriptor(event, "type")
    : undefined;
  const type = typeDescriptor && "value" in typeDescriptor ? typeDescriptor.value : undefined;
  if (type === "preview.refresh_requested") {
    observationFields(event, ["type"]);
    return { type };
  }
  if (type === "state.transition") {
    const fields = observationFields(event, ["type", "state"]);
    if (!["acquiring", "active", "cancelling", "cleaning", "closed"].includes(fields.state as string)) throw new Error("invalid");
    return { type, state: fields.state as TurnObservationEvent["state"] };
  }
  if (type === "lease.lifecycle") {
    const fields = observationFields(event, ["type", "lease"]);
    if (!["acquired", "contended", "expired", "mismatch", "released", "reused"].includes(fields.lease as string)) throw new Error("invalid");
    return { type, lease: fields.lease as TurnObservationEvent["lease"] };
  }
  if (type === "limit.decision") {
    const fields = observationFields(event, ["type", "decision", "limit", "value", "ceiling"]);
    if ((fields.decision !== "allow" && fields.decision !== "deny") || !OBSERVATION_LIMITS.has(fields.limit as TurnLimitName)) {
      throw new Error("invalid");
    }
    if (typeof fields.value !== "number" || typeof fields.ceiling !== "number") throw new Error("invalid");
    return {
      type,
      decision: fields.decision,
      limit: fields.limit as TurnLimitName,
      value: fields.value,
      ceiling: fields.ceiling,
    };
  }
  if (type === "approval.outcome" || type === "execution.outcome" || type === "cleanup.outcome") {
    const fields = observationFields(event, ["type", "outcome"]);
    const allowed = type === "approval.outcome"
      ? ["aborted", "denied", "error", "success", "timeout"]
      : type === "execution.outcome"
        ? ["aborted", "denied", "error", "success", "timeout"]
        : ["failure", "success"];
    if (!allowed.includes(fields.outcome as string)) throw new Error("invalid");
    return { type, outcome: fields.outcome as TurnObservationEvent["outcome"] };
  }
  throw new Error("invalid");
}

function observe(
  state: ControlState,
  event: Omit<TurnObservationEvent, "sequence" | "elapsedMs" | "counts">,
): void {
  if (!state.observe || state.observationDisabled) return;
  if (state.events >= state.limits.maxObservabilityEvents) {
    state.observationDisabled = true;
    fail(state, "observability_failure", "Local VM observability event limit was reached");
  }
  let sanitized: Omit<TurnObservationEvent, "sequence" | "elapsedMs" | "counts">;
  try {
    sanitized = sanitizedObservation(event);
  } catch {
    state.observationDisabled = true;
    fail(state, "observability_failure", "Local VM observability event was invalid");
  }
  const emitted = Object.freeze({
    ...sanitized,
    sequence: state.events + 1,
    elapsedMs: safeNumber(Number(nowNs() - state.startedNs) / 1_000_000),
    counts: frozenCounts(state),
    ...(sanitized.value === undefined ? {} : { value: safeNumber(sanitized.value) }),
    ...(sanitized.ceiling === undefined ? {} : { ceiling: safeNumber(sanitized.ceiling) }),
  });
  state.events += 1;
  try {
    const returned = state.observe(emitted) as unknown;
    if (returned && (typeof returned === "object" || typeof returned === "function")) {
      let then: unknown;
      try {
        then = (returned as { then?: unknown }).then;
      } catch {
        state.observationDisabled = true;
        fail(state, "observability_failure", "Local VM observability failed");
      }
      if (typeof then === "function") {
        Promise.resolve(returned).catch(() => {});
        state.observationDisabled = true;
        fail(state, "observability_failure", "Local VM observability must be synchronous");
      }
    }
  } catch {
    state.observationDisabled = true;
    fail(state, "observability_failure", "Local VM observability failed");
  }
}

function fail(state: ControlState, code: TurnFailureCode, message: string): never {
  const error = state.failure ?? new ToolTurnLimitError(code, message);
  state.failure = error;
  if (!state.controller.signal.aborted) state.controller.abort(error);
  throw error;
}

function limitDenied(
  state: ControlState,
  code: TurnFailureCode,
  limit: TurnLimitName,
  value: number,
  ceiling: number,
): never {
  observe(state, { type: "limit.decision", decision: "deny", limit, value, ceiling });
  return fail(state, code, `Local VM tool turn exceeded ${limit}`);
}

function callStateFor(control: ApplicationToolTurnControl, budget: ToolCallBudget): CallState {
  const state = stateFor(control);
  const call = callBudgets.get(budget);
  if (!call || call.owner !== state || !call.active) {
    throw new ToolTurnLimitError("closed", "Local VM tool-call budget is unavailable");
  }
  if (nowNs() >= call.deadlineNs) {
    return limitDenied(state, "timeout", "tool_call_elapsed", state.limits.toolCallTimeoutMs, state.limits.toolCallTimeoutMs);
  }
  return call;
}

export interface ToolTurnControlOwner {
  readonly control: ApplicationToolTurnControl;
  readonly signal: AbortSignal;
  readonly limits: LocalVmToolTurnLimits;
  emit(event: Omit<TurnObservationEvent, "sequence" | "elapsedMs" | "counts">): void;
  cancel(code?: "aborted" | "closed", message?: string): void;
  failure(): ToolTurnLimitError | null;
  dispose(): void;
  lifecycleResources(): { activeCalls: number; listeners: number; timers: number; events: number };
}

export function createToolTurnControl(options: {
  limits?: Partial<LocalVmToolTurnLimits>;
  signal?: AbortSignal;
  observe?: (event: TurnObservationEvent) => void;
} = {}): ToolTurnControlOwner {
  const limits = resolveLimits(options.limits);
  const control = Object.freeze({ kind: "application-tool-turn-control" as const });
  const controller = new AbortController();
  const startedNs = nowNs();
  const state: ControlState = {
    control,
    controller,
    startedNs,
    deadlineNs: startedNs + toNs(limits.turnTimeoutMs),
    limits,
    ...(options.observe ? { observe: options.observe } : {}),
    ...(options.signal ? { externalSignal: options.signal } : {}),
    timer: undefined as unknown as ReturnType<typeof setTimeout>,
    repeatKey: randomBytes(32),
    repeats: new Map(),
    activeCalls: 0,
    toolCalls: 0,
    mcpRequests: 0,
    argumentBytes: 0,
    resultBytes: 0,
    events: 0,
    closed: false,
    failure: null,
    observationDisabled: false,
  };
  state.timer = setTimeout(() => {
    if (!state.closed && !state.controller.signal.aborted) {
      try {
        observe(state, {
          type: "limit.decision",
          decision: "deny",
          limit: "elapsed_turn",
          value: limits.turnTimeoutMs,
          ceiling: limits.turnTimeoutMs,
        });
      } catch {
        // The observation boundary records its own failure and aborts below.
      }
      state.failure ??= new ToolTurnLimitError("timeout", "Local VM tool turn timed out");
      if (!state.controller.signal.aborted) state.controller.abort(state.failure);
    }
  }, limits.turnTimeoutMs);
  state.timer.unref?.();
  if (options.signal) {
    state.externalAbort = () => {
      if (state.closed || state.controller.signal.aborted) return;
      state.failure = new ToolTurnLimitError("aborted", "Local VM tool turn was cancelled");
      state.controller.abort(state.failure);
    };
    options.signal.addEventListener("abort", state.externalAbort, { once: true });
    if (options.signal.aborted) state.externalAbort();
  }
  controls.set(control, state);

  const owner: ToolTurnControlOwner = {
    control,
    signal: controller.signal,
    limits,
    emit(event): void {
      if (state.closed) return;
      observe(state, event);
    },
    cancel(code = "aborted", message = "Local VM tool turn was cancelled"): void {
      if (state.closed || state.controller.signal.aborted) return;
      state.failure = new ToolTurnLimitError(code, message);
      state.controller.abort(state.failure);
    },
    failure(): ToolTurnLimitError | null {
      return state.failure;
    },
    dispose(): void {
      if (state.closed) return;
      state.closed = true;
      clearTimeout(state.timer);
      if (state.externalSignal && state.externalAbort) {
        state.externalSignal.removeEventListener("abort", state.externalAbort);
      }
      state.repeatKey.fill(0);
      state.repeats.clear();
      state.activeCalls = 0;
    },
    lifecycleResources(): { activeCalls: number; listeners: number; timers: number; events: number } {
      return {
        activeCalls: state.closed ? 0 : state.activeCalls,
        listeners: state.closed || !state.externalSignal ? 0 : 1,
        timers: state.closed ? 0 : 1,
        events: state.events,
      };
    },
  };
  return Object.freeze(owner);
}

export function beginToolCall(
  control: ApplicationToolTurnControl,
  toolName: string,
  canonicalArguments: string,
): ToolCallBudget {
  const state = stateFor(control);
  const bytes = Buffer.byteLength(canonicalArguments, "utf8");
  if (bytes > state.limits.maxArgumentBytes) {
    return limitDenied(state, "argument_limit", "argument_bytes", bytes, state.limits.maxArgumentBytes);
  }
  if (state.toolCalls + 1 > state.limits.maxToolCalls) {
    return limitDenied(state, "tool_call_limit", "tool_calls", state.toolCalls + 1, state.limits.maxToolCalls);
  }
  if (state.argumentBytes + bytes > state.limits.maxAggregateArgumentBytes) {
    return limitDenied(
      state,
      "aggregate_limit",
      "aggregate_arguments",
      state.argumentBytes + bytes,
      state.limits.maxAggregateArgumentBytes,
    );
  }
  const fingerprint = createHmac("sha256", state.repeatKey)
    .update("agent-harbor/local-vm-repeat/v1\0")
    .update(toolName)
    .update("\0")
    .update(canonicalArguments.normalize("NFC"))
    .digest("hex");
  const repeated = (state.repeats.get(fingerprint) ?? 0) + 1;
  if (repeated > state.limits.maxRepeatedCalls) {
    return limitDenied(state, "repeat_limit", "repeated_calls", repeated, state.limits.maxRepeatedCalls);
  }

  state.repeats.set(fingerprint, repeated);
  state.toolCalls += 1;
  state.argumentBytes += bytes;
  state.activeCalls += 1;
  const startedNs = nowNs();
  const budget = Object.freeze({ kind: "local-vm-tool-call-budget" as const });
  callBudgets.set(budget, {
    owner: state,
    startedNs,
    deadlineNs: [state.deadlineNs, startedNs + toNs(state.limits.toolCallTimeoutMs)].reduce((a, b) => a < b ? a : b),
    active: true,
    resultBytes: 0,
  });
  observe(state, { type: "limit.decision", decision: "allow", limit: "tool_calls", value: state.toolCalls, ceiling: state.limits.maxToolCalls });
  return budget;
}

export function approvalDeadlineNs(
  control: ApplicationToolTurnControl,
  budget: ToolCallBudget,
  requestedTimeoutMs: number,
): bigint {
  const state = stateFor(control);
  const call = callStateFor(control, budget);
  const waitMs = Math.min(requestedTimeoutMs, state.limits.approvalWaitTimeoutMs);
  const candidate = nowNs() + toNs(waitMs);
  return [state.deadlineNs, call.deadlineNs, candidate].reduce((a, b) => a < b ? a : b);
}

export function mcpRequestDeadlineNs(
  control: ApplicationToolTurnControl,
  budget?: ToolCallBudget,
): bigint {
  const state = stateFor(control);
  const call = budget ? callStateFor(control, budget) : null;
  if (state.mcpRequests + 1 > state.limits.maxMcpRequests) {
    return limitDenied(state, "mcp_limit", "mcp_requests", state.mcpRequests + 1, state.limits.maxMcpRequests);
  }
  state.mcpRequests += 1;
  const operationDeadline = nowNs() + toNs(state.limits.mcpRequestTimeoutMs);
  return [state.deadlineNs, operationDeadline, ...(call ? [call.deadlineNs] : [])]
    .reduce((a, b) => a < b ? a : b);
}

export function toolExecutionDeadlineNs(
  control: ApplicationToolTurnControl,
  budget: ToolCallBudget,
): bigint {
  const state = stateFor(control);
  const call = callStateFor(control, budget);
  const executionDeadline = nowNs() + toNs(state.limits.toolExecutionTimeoutMs);
  return [state.deadlineNs, call.deadlineNs, executionDeadline].reduce((a, b) => a < b ? a : b);
}

export function toolResultByteLimit(
  control: ApplicationToolTurnControl,
  budget: ToolCallBudget,
): number {
  callStateFor(control, budget);
  return stateFor(control).limits.maxResultBytes;
}

export function toolArgumentByteLimit(control: ApplicationToolTurnControl): number {
  return stateFor(control).limits.maxArgumentBytes;
}

export function recordApprovalOutcome(
  control: ApplicationToolTurnControl,
  budget: ToolCallBudget,
  outcome: "allow" | "deny" | "timeout" | "aborted" | "error",
): void {
  const state = stateFor(control);
  callStateFor(control, budget);
  observe(state, {
    type: "approval.outcome",
    outcome: outcome === "allow" ? "success" : outcome === "deny" ? "denied" : outcome,
  });
}

export function recordToolResult(
  control: ApplicationToolTurnControl,
  budget: ToolCallBudget,
  bytes: number,
): void {
  const state = stateFor(control);
  const call = callStateFor(control, budget);
  const callBytes = call.resultBytes + bytes;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(callBytes) || callBytes > state.limits.maxResultBytes) {
    return limitDenied(state, "result_limit", "result_bytes", callBytes, state.limits.maxResultBytes);
  }
  if (state.resultBytes + bytes > state.limits.maxAggregateResultBytes) {
    return limitDenied(
      state,
      "aggregate_limit",
      "aggregate_results",
      state.resultBytes + bytes,
      state.limits.maxAggregateResultBytes,
    );
  }
  call.resultBytes = callBytes;
  state.resultBytes += bytes;
}

export function finishToolCall(
  control: ApplicationToolTurnControl,
  budget: ToolCallBudget,
  outcome: "success" | "denied" | "timeout" | "aborted" | "error",
  refreshPreview = false,
): void {
  const state = controls.get(control);
  const call = callBudgets.get(budget);
  if (!state || !call || call.owner !== state || !call.active) return;
  call.active = false;
  state.activeCalls = Math.max(0, state.activeCalls - 1);
  if (!state.closed && !state.observationDisabled) {
    observe(state, { type: "execution.outcome", outcome });
    if (refreshPreview && outcome === "success") observe(state, { type: "preview.refresh_requested" });
  }
}

export function deadlineRemainingMs(deadlineNs: bigint): number {
  return remainingMs(deadlineNs);
}
