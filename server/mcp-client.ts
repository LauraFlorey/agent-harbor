import { spawn, type ChildProcessByStdio } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAgentEnvironment } from "./agent-environment.ts";
import type {
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
  ProviderToolResultContent,
} from "./contracts.ts";
import {
  assertLocalVmTurnExecution,
  claimLocalVmTurnSpawn,
  releaseLocalVmTurnLease,
  type LocalVmTurnBinding,
  type LocalVmTurnLeaseHandle,
} from "./local-vm-lease.ts";
import { isLocalVmMcpEndpoint, type LocalVmMcpEndpoint } from "./local-vm-mcp.ts";
import { drainCliTrees, killCliTree, killCliTreeNow } from "./procs.ts";
import {
  createApprovedToolRequests,
  type ApprovedToolRequests,
  ToolApprovalError,
  type ToolApprovalSessionOptions,
} from "./tool-approval.ts";
import {
  deadlineRemainingMs,
  mcpRequestDeadlineNs,
  recordToolResult,
  toolExecutionDeadlineNs,
  toolResultByteLimit,
  type ApplicationToolTurnControl,
  type ToolCallBudget,
} from "./tool-turn-control.ts";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 4_096;
const MAX_SCHEMA_VALUE_NODES = 16_384;
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_AGGREGATE_SCHEMA_BYTES = 1024 * 1024;
const MAX_TOOL_COUNT = 128;
const MAX_TOOL_RESULT_ITEMS = 1_024;
const MAX_ENDPOINT_DESCRIPTOR_BYTES = 12 * 1024;
const SERVER_ROOT = dirname(fileURLToPath(import.meta.url));
const GUARDIAN_PATH = (() => {
  const ts = resolve(SERVER_ROOT, "mcp-guardian.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
const SECRET_ARGUMENT = /(?:^|[-_])(api[-_]?key|token|secret|password|credential)(?:=|$)/i;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_SCHEMA_PATTERNS = new Set(["^s[0-9a-f]{8}$"]);
const SAFE_SCHEMA_FORMATS = new Set(["double", "uint32", "uint64"]);

interface ValidatedEndpoint {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}

type McpFailureCode =
  | "aborted"
  | "closed"
  | "invalid_endpoint"
  | "invalid_response"
  | "process_failure"
  | "rpc_failure"
  | "timeout";

export type McpFailureReason =
  | "aborted"
  | "catalog_rejection"
  | "child_exit"
  | "cleanup_failure"
  | "closed"
  | "endpoint_validation"
  | "initialization_failure"
  | "request_timeout"
  | "rpc_failure"
  | "tool_discovery_failure"
  | "tool_execution_failure"
  | "transport_failure";

function defaultFailureReason(code: McpFailureCode): McpFailureReason {
  if (code === "aborted") return "aborted";
  if (code === "closed") return "closed";
  if (code === "invalid_endpoint") return "endpoint_validation";
  if (code === "rpc_failure") return "rpc_failure";
  if (code === "timeout") return "request_timeout";
  if (code === "process_failure") return "transport_failure";
  return "transport_failure";
}

export class TurnMcpError extends Error {
  readonly code: McpFailureCode;
  readonly reason: McpFailureReason;

  constructor(code: McpFailureCode, message: string, reason: McpFailureReason = defaultFailureReason(code)) {
    super(message);
    this.name = "TurnMcpError";
    this.code = code;
    this.reason = reason;
  }
}

function startupFailure(
  error: unknown,
  reason: "initialization_failure" | "tool_discovery_failure",
  message: string,
): TurnMcpError {
  if (error instanceof TurnMcpError) {
    if (error.reason === "child_exit") return error;
    return new TurnMcpError(error.code, message, reason);
  }
  return new TurnMcpError("process_failure", message, reason);
}

export interface TurnMcpClientOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  turnControl?: ApplicationToolTurnControl;
  turnLease: Readonly<{
    handle: LocalVmTurnLeaseHandle;
    binding: LocalVmTurnBinding;
  }>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: TurnMcpError) => void;
  timer: ReturnType<typeof setTimeout>;
  validate?: (value: unknown) => unknown;
}

interface JsonRpcMessage {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

function safePathEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function trustedFile(path: string, root?: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new TurnMcpError("invalid_endpoint", "Local VM MCP executable paths must be absolute");
  }
  let stat;
  let canonical;
  try {
    [stat, canonical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    throw new TurnMcpError("invalid_endpoint", "Local VM MCP executable is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || !safePathEqual(canonical, resolve(path))) {
    throw new TurnMcpError("invalid_endpoint", "Local VM MCP executable must be a trusted regular file");
  }
  if (root) {
    const within = relative(await realpath(root), canonical);
    if (within.startsWith("..") || isAbsolute(within)) {
      throw new TurnMcpError("invalid_endpoint", "Local VM MCP entry point is outside the server boundary");
    }
  }
  if (process.platform !== "win32") {
    try {
      await access(path, fsConstants.R_OK | fsConstants.X_OK);
    } catch {
      // TypeScript entry points are read by the trusted Node executable and
      // need not carry their own executable bit.
      if (!root) throw new TurnMcpError("invalid_endpoint", "Local VM MCP executable is not executable");
      await access(path, fsConstants.R_OK).catch(() => {
        throw new TurnMcpError("invalid_endpoint", "Local VM MCP entry point is unreadable");
      });
    }
  }
  return canonical;
}

function processControlEnvironment(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.startsWith("NODE_") ||
    upper.startsWith("DYLD_") ||
    upper === "LD_AUDIT" ||
    upper === "LD_LIBRARY_PATH" ||
    upper === "LD_PRELOAD";
}

async function validateEndpoint(endpoint: LocalVmMcpEndpoint): Promise<ValidatedEndpoint> {
  if (!isLocalVmMcpEndpoint(endpoint)) {
    throw new TurnMcpError("invalid_endpoint", "MCP endpoint is not scoped to the Local VM");
  }
  if (
    typeof endpoint.command !== "string" ||
    !Array.isArray(endpoint.args) ||
    !endpoint.args.every((argument) => typeof argument === "string") ||
    !isRecord(endpoint.env) ||
    !Object.values(endpoint.env).every((value) => typeof value === "string") ||
    endpoint.command.includes("\0") ||
    endpoint.args.some((argument) => argument.includes("\0"))
  ) {
    throw new TurnMcpError("invalid_endpoint", "Local VM MCP endpoint is malformed");
  }
  if (!safePathEqual(resolve(endpoint.command), resolve(process.execPath))) {
    throw new TurnMcpError("invalid_endpoint", "Local VM MCP must use Agent Harbor's trusted runtime");
  }
  const command = await trustedFile(endpoint.command);
  const entry = endpoint.args[0];
  if (!entry) throw new TurnMcpError("invalid_endpoint", "Local VM MCP entry point is missing");
  const canonicalEntry = await trustedFile(entry, SERVER_ROOT);

  const argumentBytes = Buffer.byteLength(JSON.stringify(endpoint.args));
  let environmentBytes = 0;
  for (const [key, value] of Object.entries(endpoint.env)) {
    if (!key || key.includes("=") || key.includes("\0") || value.includes("\0")) {
      throw new TurnMcpError("invalid_endpoint", "Local VM MCP environment is malformed");
    }
    if (processControlEnvironment(key)) {
      throw new TurnMcpError("invalid_endpoint", "Local VM MCP environment cannot alter the trusted runtime");
    }
    environmentBytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 2;
  }
  if (argumentBytes + environmentBytes > MAX_ENDPOINT_DESCRIPTOR_BYTES) {
    throw new TurnMcpError("invalid_endpoint", "Local VM MCP descriptor exceeds the safety limit");
  }

  if (endpoint.args.some((argument) => SECRET_ARGUMENT.test(argument))) {
    throw new TurnMcpError("invalid_endpoint", "Private MCP values must be supplied through the child environment");
  }
  for (const value of Object.values(endpoint.env)) {
    if (!value) continue;
    if (endpoint.args.some((argument) => argument === value || (value.length >= 8 && argument.includes(value)))) {
      throw new TurnMcpError("invalid_endpoint", "Private MCP values must not appear in command arguments");
    }
  }
  return Object.freeze({
    command,
    args: Object.freeze([canonicalEntry, ...endpoint.args.slice(1)]),
    env: Object.freeze({ ...endpoint.env }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCHEMA_TYPES = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

interface SchemaBudget {
  nodes: number;
}

function validateSchemaValue(value: unknown, depth: number, budget: SchemaBudget): boolean {
  budget.nodes += 1;
  if (depth > MAX_SCHEMA_DEPTH || budget.nodes > MAX_SCHEMA_VALUE_NODES) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => validateSchemaValue(item, depth + 1, budget));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => validateSchemaValue(item, depth + 1, budget));
}

function validateSchemaNode(value: unknown, depth: number, budget: SchemaBudget): boolean {
  budget.nodes += 1;
  if (depth > MAX_SCHEMA_DEPTH || budget.nodes > MAX_SCHEMA_NODES) return false;
  if (typeof value === "boolean") return true;
  if (!isRecord(value)) return false;
  if (
    (value.pattern !== undefined && (
      typeof value.pattern !== "string" || !SAFE_SCHEMA_PATTERNS.has(value.pattern)
    )) ||
    value.patternProperties !== undefined ||
    (value.format !== undefined && (
      typeof value.format !== "string" || !SAFE_SCHEMA_FORMATS.has(value.format)
    ))
  ) return false;
  for (const ref of [value.$ref, value.$dynamicRef]) {
    if (ref !== undefined && (typeof ref !== "string" || !ref.startsWith("#"))) return false;
  }
  const type = value.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.length || !types.every((item) => typeof item === "string" && SCHEMA_TYPES.has(item))) return false;
  }
  for (const key of ["properties", "$defs", "definitions", "dependentSchemas"] as const) {
    const schemas = value[key];
    if (schemas !== undefined && (
      !isRecord(schemas) || !Object.values(schemas).every((schema) => validateSchemaNode(schema, depth + 1, budget))
    )) return false;
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
    const schemas = value[key];
    if (schemas !== undefined && (
      !Array.isArray(schemas) || !schemas.every((schema) => validateSchemaNode(schema, depth + 1, budget))
    )) return false;
  }
  if (value.items !== undefined) {
    const items = value.items;
    if (
      Array.isArray(items)
        ? !items.every((schema) => validateSchemaNode(schema, depth + 1, budget))
        : !validateSchemaNode(items, depth + 1, budget)
    ) return false;
  }
  for (const key of [
    "additionalProperties",
    "contains",
    "else",
    "if",
    "not",
    "propertyNames",
    "then",
    "unevaluatedItems",
    "unevaluatedProperties",
  ] as const) {
    if (value[key] !== undefined && !validateSchemaNode(value[key], depth + 1, budget)) return false;
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      !value.required.every((item) => typeof item === "string") ||
      new Set(value.required).size !== value.required.length)
  ) return false;
  return true;
}

function schemaUsesUnsupportedExecutionFeature(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(schemaUsesUnsupportedExecutionFeature);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (
      (key === "pattern" && (typeof nested !== "string" || !SAFE_SCHEMA_PATTERNS.has(nested))) ||
      key === "patternProperties" ||
      (key === "format" && (typeof nested !== "string" || !SAFE_SCHEMA_FORMATS.has(nested)))
    ) return true;
    if (
      (key === "$ref" || key === "$dynamicRef") &&
      (typeof nested !== "string" || !nested.startsWith("#"))
    ) return true;
    if (schemaUsesUnsupportedExecutionFeature(nested)) return true;
  }
  return false;
}

function validateInputSchema(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    validateSchemaValue(value, 0, { nodes: 0 }) &&
    !schemaUsesUnsupportedExecutionFeature(value) &&
    validateSchemaNode(value, 0, { nodes: 0 });
}

function freezeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) freezeJson(item);
    return Object.freeze(value) as T;
  }
  return value;
}

function validateTools(value: unknown): ProviderToolDefinition[] {
  if (!isRecord(value) || !Array.isArray(value.tools) || value.tools.length > MAX_TOOL_COUNT) {
    throw new TurnMcpError("invalid_response", "Local VM MCP returned an invalid tool list");
  }
  const names = new Set<string>();
  let aggregateSchemaBytes = 0;
  return value.tools.map((tool) => {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      !TOOL_NAME.test(tool.name) ||
      (tool.description !== undefined && typeof tool.description !== "string") ||
      !validateInputSchema(tool.inputSchema) ||
      names.has(tool.name)
    ) {
      throw new TurnMcpError("invalid_response", "Local VM MCP returned an invalid tool definition");
    }
    const schemaBytes = Buffer.byteLength(JSON.stringify(tool.inputSchema));
    aggregateSchemaBytes += schemaBytes;
    if (schemaBytes > MAX_SCHEMA_BYTES || aggregateSchemaBytes > MAX_AGGREGATE_SCHEMA_BYTES) {
      throw new TurnMcpError("invalid_response", "Local VM MCP tool schemas exceed the safety limit");
    }
    names.add(tool.name);
    return {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: freezeJson(tool.inputSchema),
    };
  });
}

function validateToolResult(
  value: unknown,
  callId: string,
  byteLimit = MAX_MESSAGE_BYTES,
  onBytes?: (itemBytes: number, totalBytes: number) => void,
): ProviderToolResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.content) ||
    value.content.length > MAX_TOOL_RESULT_ITEMS ||
    (value.isError !== undefined && typeof value.isError !== "boolean")
  ) {
    throw new TurnMcpError("invalid_response", "Local VM MCP returned an invalid tool result");
  }
  let bytes = 0;
  const content: ProviderToolResultContent[] = value.content.map((item) => {
    if (!isRecord(item) || typeof item.type !== "string") {
      throw new TurnMcpError("invalid_response", "Local VM MCP returned an invalid tool result");
    }
    if (item.type === "text" && typeof item.text === "string") {
      const itemBytes = Buffer.byteLength(item.text);
      bytes += itemBytes;
      if (bytes > byteLimit) {
        throw new TurnMcpError("invalid_response", "Local VM MCP tool result exceeded the safety limit");
      }
      onBytes?.(itemBytes, bytes);
      return Object.freeze({ type: "text" as const, text: item.text });
    }
    if (
      item.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string" &&
      /^image\/[A-Za-z0-9.+-]{1,64}$/.test(item.mimeType)
    ) {
      const itemBytes = Buffer.byteLength(item.data) + Buffer.byteLength(item.mimeType);
      bytes += itemBytes;
      if (bytes > byteLimit) {
        throw new TurnMcpError("invalid_response", "Local VM MCP tool result exceeded the safety limit");
      }
      onBytes?.(itemBytes, bytes);
      return Object.freeze({ type: "image" as const, data: item.data, mimeType: item.mimeType });
    }
    throw new TurnMcpError("invalid_response", "Local VM MCP returned an unsupported tool result");
  });
  return Object.freeze({
    callId,
    content,
    isError: value.isError === true,
  });
}

/** Owns exactly one Local VM MCP subprocess for exactly one agent turn. Tool
 * execution is exposed only through the application-owned approval gate. */
export class TurnScopedMcpClient {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly signal?: AbortSignal;
  private readonly onAbort: () => void;
  private readonly onHostExit: () => void;
  private nextId = 1;
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private stopped = false;
  private failure: TurnMcpError | null = null;
  private stopTask: Promise<void> | null = null;
  private readonly requestTimeoutMs: number;
  private readonly turnControl?: ApplicationToolTurnControl;
  private readonly turnLease?: TurnMcpClientOptions["turnLease"];
  private discoveredTools: readonly ProviderToolDefinition[] = [];
  private readonly approvalSessions = new Set<ApprovedToolRequests>();
  private approvalSessionCreated = false;
  private rejectTermination!: (error: TurnMcpError) => void;
  private readonly termination: Promise<never>;

  private constructor(
    child: ChildProcessByStdio<Writable, Readable, Readable>,
    requestTimeoutMs: number,
    signal?: AbortSignal,
    turnControl?: ApplicationToolTurnControl,
    turnLease?: TurnMcpClientOptions["turnLease"],
  ) {
    this.child = child;
    this.requestTimeoutMs = requestTimeoutMs;
    this.signal = signal;
    this.turnControl = turnControl;
    this.turnLease = turnLease;
    this.termination = new Promise<never>((_resolve, reject) => {
      this.rejectTermination = reject;
    });
    this.termination.catch(() => {});
    this.onAbort = () => this.fail(new TurnMcpError("aborted", "Local VM MCP turn was aborted"));
    this.onHostExit = () => {
      this.fail(new TurnMcpError("closed", "Agent Harbor exited during the Local VM MCP turn"));
      killCliTreeNow(this.child);
      if (this.turnLease) releaseLocalVmTurnLease(this.turnLease.handle, this.turnLease.binding);
    };
  }

  static async connect(
    endpoint: LocalVmMcpEndpoint,
    options: TurnMcpClientOptions,
  ): Promise<TurnScopedMcpClient> {
    const turnLease = options.turnLease;
    if (!turnLease) {
      throw new TurnMcpError("invalid_endpoint", "Local VM MCP child creation requires an application lease");
    }
    let client: TurnScopedMcpClient | null = null;
    try {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5 * 60_000) {
        throw new TurnMcpError("invalid_endpoint", "Local VM MCP timeout is outside the safety limit");
      }
      if (options.signal?.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");
      const validated = await validateEndpoint(endpoint);
      if (options.signal?.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");

      const guardian = await trustedFile(GUARDIAN_PATH, SERVER_ROOT);
      if (options.signal?.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");
      const leaseSignal = claimLocalVmTurnSpawn(turnLease.handle, turnLease.binding);
      const signal = options.signal ? AbortSignal.any([leaseSignal, options.signal]) : leaseSignal;
      if (signal.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");
      const child = spawn(validated.command, [guardian], {
        cwd: SERVER_ROOT,
        env: buildAgentEnvironment({
          overrides: {
            ...validated.env,
            AGENT_HARBOR_MCP_COMMAND: validated.command,
            AGENT_HARBOR_MCP_ARGS: JSON.stringify(validated.args),
          },
        }),
        stdio: ["pipe", "pipe", "pipe"],
        ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
      });
      client = new TurnScopedMcpClient(
        child,
        timeoutMs,
        signal,
        options.turnControl,
        turnLease,
      );
      const startupDeadline = process.hrtime.bigint() + BigInt(Math.ceil(timeoutMs * 1_000_000));
      client.attach();
      try {
        await client.request("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "agent-harbor", version: "0.1" },
        }, options.turnControl ? mcpRequestDeadlineNs(options.turnControl) : startupDeadline);
        client.notify("notifications/initialized");
      } catch (error) {
        throw startupFailure(error, "initialization_failure", "Local VM MCP initialization failed");
      }
      let discovered: unknown;
      try {
        discovered = await client.request(
          "tools/list",
          {},
          options.turnControl ? mcpRequestDeadlineNs(options.turnControl) : startupDeadline,
        );
      } catch (error) {
        throw startupFailure(error, "tool_discovery_failure", "Local VM MCP tool discovery failed");
      }
      let tools: ProviderToolDefinition[];
      try {
        tools = validateTools(discovered);
      } catch (error) {
        const code = error instanceof TurnMcpError ? error.code : "invalid_response";
        throw new TurnMcpError(code, "Local VM MCP tool catalog was rejected", "catalog_rejection");
      }
      client.discoveredTools = Object.freeze(
        tools.map((tool) => Object.freeze(tool)),
      );
      return client;
    } catch (error) {
      if (client) await client.dispose().catch(() => {});
      else releaseLocalVmTurnLease(turnLease.handle, turnLease.binding);
      throw error;
    }
  }

  get tools(): readonly ProviderToolDefinition[] {
    return this.discoveredTools;
  }

  /** Creates a provider-facing request handle with no approval method. Its
   * execution authority is derived only from this client's trusted discovery. */
  createToolApprovalSession(
    options: Omit<ToolApprovalSessionOptions, "signal" | "turnControl">,
  ): ApprovedToolRequests {
    if (this.stopped) throw this.failure ?? new TurnMcpError("closed", "Local VM MCP turn is closed");
    if (this.approvalSessionCreated) {
      throw new ToolApprovalError("invalid_call", "A Local VM MCP approval session already exists for this turn");
    }
    let session: ApprovedToolRequests;
    session = createApprovedToolRequests(
      this.discoveredTools,
      (call, budget) => this.executeApprovedTool(call, budget),
      { ...options, signal: this.signal, ...(this.turnControl ? { turnControl: this.turnControl } : {}) },
    );
    this.approvalSessionCreated = true;
    this.approvalSessions.add(session);
    return session;
  }

  /** Resource counts are intentionally content-free: tests and shutdown
   * diagnostics can prove ownership was released without exposing arguments,
   * environment values, or MCP traffic. */
  lifecycleResources(): { child: number; listeners: number; pending: number; timers: number } {
    return {
      child: this.stopped ? 0 : 1,
      listeners: this.stopped ? 0 : 7 + (this.signal ? 1 : 0),
      pending: this.pending.size,
      timers: this.timers.size,
    };
  }

  /** Interrupt the turn. Idempotent and safe to call concurrently with any
   * provider or MCP failure. */
  async close(): Promise<void> {
    this.fail(new TurnMcpError("closed", "Local VM MCP turn was closed"));
    await this.dispose();
  }

  private attach(): void {
    this.child.stdout.on("data", this.onData);
    this.child.stdout.on("error", this.onStdoutError);
    this.child.on("error", this.onProcessError);
    this.child.on("exit", this.onProcessExit);
    this.child.stdin.on("error", this.onStdinError);
    this.child.stderr.on("error", this.onStderrError);
    this.child.stderr.resume();
    process.once("exit", this.onHostExit);
    this.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (this.signal?.aborted) this.onAbort();
  }

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer) > MAX_MESSAGE_BYTES) {
      this.fail(new TurnMcpError("invalid_response", "Local VM MCP response exceeded the safety limit"));
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      if (line === "{agent-harbor-mcp-child-exited}") {
        this.fail(new TurnMcpError("process_failure", "Local VM MCP process exited", "child_exit"));
        return;
      }
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        this.fail(new TurnMcpError("invalid_response", "Local VM MCP returned malformed JSON"));
        return;
      }
      if (!isRecord(message) || (typeof message.id !== "number" && typeof message.id !== "string")) continue;
      const pending = this.pending.get(Number(message.id));
      if (!pending) continue;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      this.timers.delete(pending.timer);
      if (message.error !== undefined) {
        const error = new TurnMcpError("rpc_failure", "Local VM MCP request failed");
        pending.reject(error);
        this.fail(error);
        return;
      } else {
        let result = message.result;
        try {
          result = pending.validate ? pending.validate(result) : result;
        } catch (error) {
          const failure = error instanceof TurnMcpError
            ? error
            : new TurnMcpError("invalid_response", "Local VM MCP returned an invalid response");
          pending.reject(failure);
          this.fail(failure);
          return;
        }
        pending.resolve(result);
      }
    }
  };

  private readonly onProcessError = (): void => {
    this.fail(new TurnMcpError("process_failure", "Local VM MCP process failed", "child_exit"));
  };

  private readonly onStdoutError = (): void => {
    if (!this.stopped) this.fail(new TurnMcpError("process_failure", "Local VM MCP output closed"));
  };

  private readonly onProcessExit = (): void => {
    if (!this.stopped) this.fail(new TurnMcpError("process_failure", "Local VM MCP process exited", "child_exit"));
  };

  private readonly onStdinError = (): void => {
    if (!this.stopped) this.fail(new TurnMcpError("process_failure", "Local VM MCP input closed"));
  };

  private readonly onStderrError = (): void => {
    if (!this.stopped) this.fail(new TurnMcpError("process_failure", "Local VM MCP error stream failed"));
  };

  private notify(method: string, params?: unknown): void {
    if (this.stopped) throw this.failure ?? new TurnMcpError("closed", "Local VM MCP turn is closed");
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`);
  }

  private request(
    method: string,
    params: unknown,
    deadlineNs: bigint,
    validate?: (value: unknown) => unknown,
  ): Promise<unknown> {
    if (this.stopped) {
      return Promise.reject(this.failure ?? new TurnMcpError("closed", "Local VM MCP turn is closed"));
    }
    const remaining = deadlineRemainingMs(deadlineNs);
    if (remaining <= 0) return Promise.reject(new TurnMcpError("timeout", "Local VM MCP request timed out"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let pending: PendingRequest;
      const expire = (): void => {
        this.timers.delete(pending.timer);
        const next = deadlineRemainingMs(deadlineNs);
        if (next > 0) {
          pending.timer = setTimeout(expire, next);
          pending.timer.unref?.();
          this.timers.add(pending.timer);
          return;
        }
        this.pending.delete(id);
        const error = new TurnMcpError("timeout", "Local VM MCP request timed out");
        reject(error);
        this.fail(error);
      };
      const timer = setTimeout(expire, remaining);
      timer.unref?.();
      this.timers.add(timer);
      pending = { resolve, reject, timer, ...(validate ? { validate } : {}) };
      this.pending.set(id, pending);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private async executeApprovedTool(call: ProviderToolCall, budget?: ToolCallBudget): Promise<ProviderToolResult> {
    try {
      if (this.turnLease) assertLocalVmTurnExecution(this.turnLease.handle, this.turnLease.binding);
      const executionDeadline = this.turnControl && budget
        ? toolExecutionDeadlineNs(this.turnControl, budget)
        : process.hrtime.bigint() + BigInt(Math.ceil(this.requestTimeoutMs * 1_000_000));
      const requestDeadline = this.turnControl
        ? mcpRequestDeadlineNs(this.turnControl, budget)
        : executionDeadline;
      const deadline = requestDeadline < executionDeadline ? requestDeadline : executionDeadline;
      const byteLimit = this.turnControl && budget
        ? toolResultByteLimit(this.turnControl, budget)
        : MAX_MESSAGE_BYTES;
      const result = await this.request("tools/call", {
        name: call.name,
        arguments: call.arguments,
      }, deadline, (value) => validateToolResult(value, call.id, byteLimit, (itemBytes) => {
        if (this.turnControl && budget) recordToolResult(this.turnControl, budget, itemBytes);
      }));
      return result as ProviderToolResult;
    } catch (error) {
      const failure = error instanceof TurnMcpError
        ? error
        : new TurnMcpError("invalid_response", "Local VM MCP returned an invalid tool result");
      this.fail(failure);
      throw failure;
    }
  }

  private fail(error: TurnMcpError): void {
    if (this.stopped) return;
    this.failure = error;
    this.rejectTermination(error);
    for (const pending of this.pending.values()) pending.reject(error);
    void this.dispose().catch(() => {});
  }

  private dispose(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = (async () => {
      let cleanupFailed = false;
      const cleanup = (action: () => void): void => {
        try {
          action();
        } catch {
          cleanupFailed = true;
        }
      };
      try {
        cleanup(() => this.signal?.removeEventListener("abort", this.onAbort));
        cleanup(() => this.child.stdout.off("data", this.onData));
        cleanup(() => this.child.stdout.off("error", this.onStdoutError));
        cleanup(() => this.child.off("error", this.onProcessError));
        cleanup(() => this.child.off("exit", this.onProcessExit));
        cleanup(() => this.child.stdin.off("error", this.onStdinError));
        cleanup(() => this.child.stderr.off("error", this.onStderrError));
        cleanup(() => this.child.stdout.pause());
        cleanup(() => this.child.stderr.pause());
        for (const session of this.approvalSessions) cleanup(() => session.close());
        this.approvalSessions.clear();
        for (const pending of this.pending.values()) {
          cleanup(() => clearTimeout(pending.timer));
          cleanup(() => pending.reject(new TurnMcpError("closed", "Local VM MCP turn is closed")));
        }
        this.pending.clear();
        for (const timer of this.timers) cleanup(() => clearTimeout(timer));
        this.timers.clear();
        this.buffer = "";
        cleanup(() => { this.decoder.end(); });
        cleanup(() => this.child.stdin.end());
        cleanup(() => killCliTree(this.child));
        try {
          await drainCliTrees();
        } catch {
          cleanupFailed = true;
        }
      } finally {
        cleanup(() => process.off("exit", this.onHostExit));
        if (this.turnLease) {
          cleanup(() => { releaseLocalVmTurnLease(this.turnLease!.handle, this.turnLease!.binding); });
        }
      }
      if (cleanupFailed) {
        throw new TurnMcpError("closed", "Local VM MCP cleanup failed", "cleanup_failure");
      }
    })();
    return this.stopTask;
  }

  async runUntilSettled<T>(providerTurn: (client: TurnScopedMcpClient) => Promise<T>): Promise<T> {
    return Promise.race([providerTurn(this), this.termination]);
  }

  async finish(): Promise<void> {
    await this.dispose();
  }
}

/** The only supported owner for this client. Its `finally` fence means a
 * provider cannot forget to release the MCP process on any exit path. */
export async function withTurnScopedMcpClient<T>(
  endpoint: LocalVmMcpEndpoint,
  options: TurnMcpClientOptions,
  providerTurn: (client: TurnScopedMcpClient) => Promise<T>,
): Promise<T> {
  const client = await TurnScopedMcpClient.connect(endpoint, options);
  try {
    return await client.runUntilSettled(providerTurn);
  } finally {
    await client.finish();
  }
}
