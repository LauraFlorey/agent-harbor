import { spawn, type ChildProcessByStdio } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAgentEnvironment } from "./agent-environment.ts";
import type { ProviderToolDefinition } from "./contracts.ts";
import { isLocalVmMcpEndpoint, type LocalVmMcpEndpoint } from "./local-vm-mcp.ts";
import { drainCliTrees, killCliTree } from "./procs.ts";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_ENDPOINT_DESCRIPTOR_BYTES = 12 * 1024;
const SERVER_ROOT = dirname(fileURLToPath(import.meta.url));
const GUARDIAN_PATH = (() => {
  const ts = resolve(SERVER_ROOT, "mcp-guardian.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
const SECRET_ARGUMENT = /(?:^|[-_])(api[-_]?key|token|secret|password|credential)(?:=|$)/i;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;

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

export class TurnMcpError extends Error {
  readonly code: McpFailureCode;

  constructor(code: McpFailureCode, message: string) {
    super(message);
    this.name = "TurnMcpError";
    this.code = code;
  }
}

export interface TurnMcpClientOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: TurnMcpError) => void;
  timer: ReturnType<typeof setTimeout>;
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

function validateSchemaValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_SCHEMA_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => validateSchemaValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => validateSchemaValue(item, depth + 1));
}

function validateSchemaNode(value: unknown, depth = 0): boolean {
  if (typeof value === "boolean") return true;
  if (!isRecord(value) || depth > MAX_SCHEMA_DEPTH || !validateSchemaValue(value, depth)) return false;
  const type = value.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.length || !types.every((item) => typeof item === "string" && SCHEMA_TYPES.has(item))) return false;
  }
  for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"] as const) {
    const schemas = value[key];
    if (schemas !== undefined && (
      !isRecord(schemas) || !Object.values(schemas).every((schema) => validateSchemaNode(schema, depth + 1))
    )) return false;
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
    const schemas = value[key];
    if (schemas !== undefined && (
      !Array.isArray(schemas) || !schemas.every((schema) => validateSchemaNode(schema, depth + 1))
    )) return false;
  }
  if (value.items !== undefined) {
    const items = value.items;
    if (
      Array.isArray(items)
        ? !items.every((schema) => validateSchemaNode(schema, depth + 1))
        : !validateSchemaNode(items, depth + 1)
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
    if (value[key] !== undefined && !validateSchemaNode(value[key], depth + 1)) return false;
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      !value.required.every((item) => typeof item === "string") ||
      new Set(value.required).size !== value.required.length)
  ) return false;
  return true;
}

function validateInputSchema(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && validateSchemaNode(value);
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
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    throw new TurnMcpError("invalid_response", "Local VM MCP returned an invalid tool list");
  }
  const names = new Set<string>();
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
    names.add(tool.name);
    return {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: freezeJson(tool.inputSchema),
    };
  });
}

/** Owns exactly one Local VM MCP subprocess for exactly one agent turn. This
 * story intentionally exposes discovery only; tool execution belongs to the
 * later tool-loop stories. */
export class TurnScopedMcpClient {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly signal?: AbortSignal;
  private readonly onAbort: () => void;
  private nextId = 1;
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private stopped = false;
  private failure: TurnMcpError | null = null;
  private stopTask: Promise<void> | null = null;
  private discoveredTools: readonly ProviderToolDefinition[] = [];
  private rejectTermination!: (error: TurnMcpError) => void;
  private readonly termination: Promise<never>;

  private constructor(
    child: ChildProcessByStdio<Writable, Readable, Readable>,
    signal?: AbortSignal,
  ) {
    this.child = child;
    this.signal = signal;
    this.termination = new Promise<never>((_resolve, reject) => {
      this.rejectTermination = reject;
    });
    this.termination.catch(() => {});
    this.onAbort = () => this.fail(new TurnMcpError("aborted", "Local VM MCP turn was aborted"));
  }

  static async connect(
    endpoint: LocalVmMcpEndpoint,
    options: TurnMcpClientOptions = {},
  ): Promise<TurnScopedMcpClient> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TurnMcpError("invalid_endpoint", "Local VM MCP timeout must be positive");
    }
    if (options.signal?.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");
    const validated = await validateEndpoint(endpoint);
    if (options.signal?.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");

    const guardian = await trustedFile(GUARDIAN_PATH, SERVER_ROOT);
    if (options.signal?.aborted) throw new TurnMcpError("aborted", "Local VM MCP turn was aborted");
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
    const client = new TurnScopedMcpClient(child, options.signal);
    const deadline = Date.now() + timeoutMs;
    try {
      client.attach();
      await client.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "agent-harbor", version: "0.1" },
      }, deadline);
      client.notify("notifications/initialized");
      const tools = validateTools(await client.request("tools/list", {}, deadline));
      client.discoveredTools = Object.freeze(
        tools.map((tool) => Object.freeze(tool)),
      );
      return client;
    } catch (error) {
      await client.dispose();
      throw error;
    }
  }

  get tools(): readonly ProviderToolDefinition[] {
    return this.discoveredTools;
  }

  /** Resource counts are intentionally content-free: tests and shutdown
   * diagnostics can prove ownership was released without exposing arguments,
   * environment values, or MCP traffic. */
  lifecycleResources(): { child: number; listeners: number; pending: number; timers: number } {
    return {
      child: this.stopped ? 0 : 1,
      listeners: this.stopped ? 0 : 6 + (this.signal ? 1 : 0),
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
        pending.reject(new TurnMcpError("rpc_failure", "Local VM MCP request failed"));
      } else {
        pending.resolve(message.result);
      }
    }
  };

  private readonly onProcessError = (): void => {
    this.fail(new TurnMcpError("process_failure", "Local VM MCP process failed"));
  };

  private readonly onStdoutError = (): void => {
    if (!this.stopped) this.fail(new TurnMcpError("process_failure", "Local VM MCP output closed"));
  };

  private readonly onProcessExit = (): void => {
    if (!this.stopped) this.fail(new TurnMcpError("process_failure", "Local VM MCP process exited"));
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

  private request(method: string, params: unknown, deadline: number): Promise<unknown> {
    if (this.stopped) {
      return Promise.reject(this.failure ?? new TurnMcpError("closed", "Local VM MCP turn is closed"));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new TurnMcpError("timeout", "Local VM MCP initialization timed out"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.timers.delete(timer);
        const error = new TurnMcpError("timeout", "Local VM MCP initialization timed out");
        reject(error);
        this.fail(error);
      }, remaining);
      timer.unref?.();
      this.timers.add(timer);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private fail(error: TurnMcpError): void {
    if (this.stopped) return;
    this.failure = error;
    this.rejectTermination(error);
    for (const pending of this.pending.values()) pending.reject(error);
    void this.dispose();
  }

  private dispose(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = (async () => {
      this.signal?.removeEventListener("abort", this.onAbort);
      this.child.stdout.off("data", this.onData);
      this.child.stdout.off("error", this.onStdoutError);
      this.child.off("error", this.onProcessError);
      this.child.off("exit", this.onProcessExit);
      this.child.stdin.off("error", this.onStdinError);
      this.child.stderr.off("error", this.onStderrError);
      this.child.stdout.pause();
      this.child.stderr.pause();
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new TurnMcpError("closed", "Local VM MCP turn is closed"));
      }
      this.pending.clear();
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
      this.buffer = "";
      this.decoder.end();
      try {
        this.child.stdin.end();
      } catch {
        /* already closed */
      }
      killCliTree(this.child);
      await drainCliTrees();
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
