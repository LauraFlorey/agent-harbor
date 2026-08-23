// OpenRouter driver — OpenAI-compatible chat completions with account-aware
// model discovery. The API key arrives through the instance environment and
// is never retained in config.json, returned to the renderer, or logged.
import type {
  DriverCreateInput,
  ModelCatalog,
  ProviderDriver,
  ProviderErrorCode,
  ProviderInstance,
  ProviderSnapshot,
  ProviderToolCall,
  ProviderToolDefinition,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId, ProviderError } from "../contracts.ts";
import { appendNative } from "./native.ts";

const DRIVER_KIND = "openrouter";
const DEFAULT_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/auto";
const DEFAULT_COMPLETION_TIMEOUT_MS = 120_000;
const MAX_SSE_LINE_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_CALLS = 64;
const MAX_TOOL_ID_BYTES = 1024;
const MAX_TOOL_NAME_BYTES = 1024;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
const MAX_TOTAL_TOOL_ARGUMENT_BYTES = 1024 * 1024;
const MAX_TOOL_DEFINITIONS_BYTES = 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_JSON_SERIALIZATION_DEPTH = 64;
const STATIC_MODELS: ModelCatalog = {
  default: DEFAULT_MODEL,
  options: [{ id: DEFAULT_MODEL, label: "Auto (OpenRouter)" }],
};

export interface OpenRouterConfig {
  url: string;
  /** Resolved at create-time from the instance environment / app config. */
  apiKeyEnv: string;
}

interface OpenRouterErrorBody {
  error?: { code?: number | string; message?: string; metadata?: unknown };
}

interface OpenRouterMessage {
  role: string;
  content: string;
}

export interface OpenRouterStreamRequest {
  url: string;
  apiKey: string;
  model: string;
  messages: readonly OpenRouterMessage[];
  /** Presence enables strict tool-transport parsing, including for an empty list. */
  tools?: readonly ProviderToolDefinition[];
  signal?: AbortSignal;
  timeoutMs?: number;
  onTextDelta?: (delta: string) => void;
}

export interface OpenRouterStreamResult {
  text: string;
  toolCalls: ProviderToolCall[];
  usage: { input: number; output: number } | null;
  finishReason: string | null;
}

interface PendingToolCall {
  index: number;
  id: string | null;
  name: string;
  nameBytes: number;
  argumentsJson: string;
  argumentBytes: number;
}

function decodeConfig(raw: unknown): OpenRouterConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    url: typeof value.url === "string" && value.url.trim() ? value.url.replace(/\/+$/, "") : DEFAULT_URL,
    apiKeyEnv: typeof value.apiKeyEnv === "string" && value.apiKeyEnv.trim()
      ? value.apiKeyEnv
      : "OPENROUTER_API_KEY",
  };
}

function providerErrorCode(status: number, catalog = false): ProviderErrorCode {
  if (status === 401 || status === 403) return "invalid_credentials";
  if (status === 402 || status === 408 || status === 429) return "quota_or_region_restriction";
  if (catalog) return "model_catalog_outage";
  return "upstream_outage";
}

function safeMessage(value: unknown, apiKey: string): string {
  const text = typeof value === "string" ? value : "OpenRouter request failed";
  return (apiKey ? text.replaceAll(apiKey, "[redacted]") : text).slice(0, 300);
}

async function responseError(response: Response, apiKey: string, catalog = false): Promise<ProviderError> {
  let body: OpenRouterErrorBody = {};
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let encodedBytes = 0;
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        encodedBytes += value.byteLength;
        if (encodedBytes > MAX_ERROR_BODY_BYTES) {
          await reader.cancel();
          text = "";
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
      if (text) {
        text += decoder.decode();
        body = JSON.parse(text) as OpenRouterErrorBody;
      }
    } catch {
      // Some upstream failures return HTML, invalid JSON, or a broken body.
      // Do not echo any of it.
    } finally {
      reader.releaseLock();
    }
  }
  const message = safeMessage(body.error?.message, apiKey);
  return new ProviderError(
    providerErrorCode(response.status, catalog),
    `OpenRouter HTTP ${response.status}: ${message}`,
  );
}

function modelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:/-]{0,199}$/i.test(value);
}

function modelLabel(record: Record<string, unknown>, id: string): string {
  const name = record.name;
  if (typeof name === "string" && name.trim()) return name.trim().slice(0, 120);
  return id;
}

/** Fetch the models permitted by this account's preferences and guardrails. */
export async function fetchOpenRouterModels(
  apiKey: string,
  url = DEFAULT_URL,
  fetcher: typeof fetch = fetch,
): Promise<ModelCatalog> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  timeout.unref?.();
  try {
    const response = await fetcher(`${url.replace(/\/+$/, "")}/models/user`, {
      headers: { authorization: `Bearer ${apiKey}`, "x-title": "Agent Harbor" },
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError(response, apiKey, true);
    const payload = await response.json() as { data?: unknown };
    const records = Array.isArray(payload.data) ? payload.data : [];
    const seen = new Set<string>();
    const options = records.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (!modelId(record.id) || seen.has(record.id)) return [];
      const architecture = record.architecture;
      const outputModalities = architecture && typeof architecture === "object"
        ? (architecture as { output_modalities?: unknown }).output_modalities
        : undefined;
      if (Array.isArray(outputModalities) && !outputModalities.includes("text")) return [];
      seen.add(record.id);
      return [{ id: record.id, label: modelLabel(record, record.id) }];
    });
    if (!options.length) {
      throw new ProviderError("model_catalog_outage", "OpenRouter returned no text models for this account");
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    return {
      default: options.some((option) => option.id === DEFAULT_MODEL) ? DEFAULT_MODEL : options[0].id,
      options,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? "OpenRouter model discovery timed out"
      : `OpenRouter model discovery failed: ${safeMessage(error instanceof Error ? error.message : error, apiKey)}`;
    throw new ProviderError("model_catalog_outage", message, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : [])
    .join("");
}

function streamError(chunk: unknown, apiKey: string): ProviderError | null {
  if (!chunk || typeof chunk !== "object") return null;
  const error = (chunk as OpenRouterErrorBody).error;
  if (!error) return null;
  const numeric = typeof error.code === "number" ? error.code : Number(error.code);
  const status = Number.isFinite(numeric) ? numeric : 502;
  return new ProviderError(providerErrorCode(status), safeMessage(error.message, apiKey));
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function malformedStream(message: string): ProviderError {
  return new ProviderError("upstream_outage", `Malformed OpenRouter stream: ${message}`);
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0x22 || unit === 0x5c || unit === 0x08 || unit === 0x09
      || unit === 0x0a || unit === 0x0c || unit === 0x0d) {
      bytes += 2;
    } else if (unit <= 0x1f || (unit >= 0xd800 && unit <= 0xdfff)) {
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
          continue;
        }
      }
      bytes += 6;
    } else if (unit <= 0x7f) {
      bytes += 1;
    } else if (unit <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Measure JSON encoding before JSON.stringify can allocate past the cap. */
function assertBoundedJson(value: unknown, limit: number): void {
  let bytes = 0;
  const active = new WeakSet<object>();
  const add = (amount: number) => {
    bytes += amount;
    if (bytes > limit) throw malformedStream("tool definitions exceed the transport limit");
  };
  const visit = (item: unknown, depth: number): void => {
    if (depth > MAX_JSON_SERIALIZATION_DEPTH) {
      throw malformedStream("tool definitions are not JSON-serializable");
    }
    if (item === null) {
      add(4);
      return;
    }
    if (typeof item === "string") {
      add(jsonStringBytes(item));
      return;
    }
    if (typeof item === "boolean") {
      add(item ? 4 : 5);
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw malformedStream("tool definitions are not JSON-serializable");
      add(String(item === 0 ? 0 : item).length);
      return;
    }
    if (!item || typeof item !== "object") {
      throw malformedStream("tool definitions are not JSON-serializable");
    }
    if (active.has(item)) throw malformedStream("tool definitions are not JSON-serializable");
    if ("toJSON" in item) {
      throw malformedStream("tool definitions are not JSON-serializable");
    }
    active.add(item);
    try {
      if (Array.isArray(item)) {
        add(2 + Math.max(0, item.length - 1));
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor) add(4);
          else if ("value" in descriptor) visit(descriptor.value, depth + 1);
          else throw malformedStream("tool definitions are not JSON-serializable");
        }
        return;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw malformedStream("tool definitions are not JSON-serializable");
      }
      add(2);
      let fields = 0;
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) {
          throw malformedStream("tool definitions are not JSON-serializable");
        }
        if (fields > 0) add(1);
        fields += 1;
        add(jsonStringBytes(key) + 1);
        visit(descriptor.value, depth + 1);
      }
    } finally {
      active.delete(item);
    }
  };
  visit(value, 0);
}

function openRouterTools(tools: readonly ProviderToolDefinition[]): Array<Record<string, unknown>> {
  if (tools.length > MAX_TOOL_CALLS) throw malformedStream("too many tool definitions");
  const mapped = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: tool.inputSchema,
    },
  }));
  assertBoundedJson(mapped, MAX_TOOL_DEFINITIONS_BYTES);
  return mapped;
}

/**
 * One streamed OpenRouter completion, normalized at the provider boundary.
 * This function only translates transport data. It does not execute calls,
 * send tool results, or continue a model/tool loop.
 */
export async function streamOpenRouterCompletion(
  request: OpenRouterStreamRequest,
  fetcher: typeof fetch = fetch,
): Promise<OpenRouterStreamResult> {
  const strictTools = request.tools !== undefined;
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ProviderError("upstream_outage", "OpenRouter timeout must be positive");
  }
  let abortKind: "caller" | "timeout" | null = null;
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return;
    abortKind = "timeout";
    controller.abort(new DOMException("OpenRouter request timed out", "TimeoutError"));
  }, timeoutMs);
  timeout.unref?.();
  const forwardAbort = () => {
    if (controller.signal.aborted) return;
    abortKind = "caller";
    controller.abort(new DOMException("Aborted", "AbortError"));
  };
  if (request.signal?.aborted) forwardAbort();
  else request.signal?.addEventListener("abort", forwardAbort, { once: true });

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamStarted = false;
  try {
    controller.signal.throwIfAborted();
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
    };
    if (request.tools?.length) body.tools = openRouterTools(request.tools);

    const response = await fetcher(`${request.url.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
        "x-title": "Agent Harbor",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError(response, request.apiKey);
    if (!response.body) throw new ProviderError("upstream_outage", "OpenRouter returned an empty stream");

    streamStarted = true;
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const pending = new Map<number, PendingToolCall>();
    const ids = new Map<string, number>();
    let buffer = "";
    let text = "";
    let textBytes = 0;
    let totalArgumentBytes = 0;
    let usage: { input: number; output: number } | null = null;
    let finishReason: string | null = null;
    let sawDone = false;

    const appendText = (delta: string) => {
      const addedBytes = byteLength(delta);
      if (textBytes + addedBytes > MAX_TEXT_BYTES) throw malformedStream("assistant text exceeds the transport limit");
      textBytes += addedBytes;
      text += delta;
      request.onTextDelta?.(delta);
    };

    const appendToolDelta = (raw: unknown) => {
      if (!raw || typeof raw !== "object") throw malformedStream("tool-call delta is not an object");
      const delta = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(delta.index) || (delta.index as number) < 0) {
        throw malformedStream("tool-call delta has an invalid index");
      }
      const index = delta.index as number;
      let call = pending.get(index);
      if (!call) {
        if (pending.size >= MAX_TOOL_CALLS) throw malformedStream("too many tool calls");
        call = { index, id: null, name: "", nameBytes: 0, argumentsJson: "", argumentBytes: 0 };
        pending.set(index, call);
      }
      if (delta.type !== undefined && delta.type !== null && delta.type !== "function") {
        throw malformedStream("tool-call type is not function");
      }
      if (delta.id !== undefined && delta.id !== null) {
        if (typeof delta.id !== "string" || !delta.id) throw malformedStream("tool-call ID is invalid");
        if (byteLength(delta.id) > MAX_TOOL_ID_BYTES) {
          throw malformedStream("tool-call ID exceeds the transport limit");
        }
        if (call.id !== null && call.id !== delta.id) throw malformedStream("tool-call ID changed for an index");
        const previousIndex = ids.get(delta.id);
        if (previousIndex !== undefined && previousIndex !== index) {
          throw malformedStream("tool-call ID was reused across indexes");
        }
        call.id = delta.id;
        ids.set(delta.id, index);
      }
      if (delta.function === undefined || delta.function === null) return;
      if (!delta.function || typeof delta.function !== "object") {
        throw malformedStream("tool-call function delta is invalid");
      }
      const fn = delta.function as Record<string, unknown>;
      if (fn.name !== undefined && fn.name !== null) {
        if (typeof fn.name !== "string") throw malformedStream("tool-call name fragment is invalid");
        const addedBytes = byteLength(fn.name);
        if (call.nameBytes + addedBytes > MAX_TOOL_NAME_BYTES) {
          throw malformedStream("tool-call name exceeds the transport limit");
        }
        call.nameBytes += addedBytes;
        call.name += fn.name;
      }
      if (fn.arguments !== undefined && fn.arguments !== null) {
        if (typeof fn.arguments !== "string") throw malformedStream("tool-call argument fragment is invalid");
        const addedBytes = byteLength(fn.arguments);
        if (call.argumentBytes + addedBytes > MAX_TOOL_ARGUMENT_BYTES
          || totalArgumentBytes + addedBytes > MAX_TOTAL_TOOL_ARGUMENT_BYTES) {
          throw malformedStream("tool-call arguments exceed the transport limit");
        }
        call.argumentBytes += addedBytes;
        totalArgumentBytes += addedBytes;
        call.argumentsJson += fn.arguments;
      }
    };

    const consume = (line: string) => {
      if (byteLength(line) > MAX_SSE_LINE_BYTES) throw malformedStream("SSE event exceeds the transport limit");
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data) return;
      if (sawDone) {
        if (strictTools) throw malformedStream("data arrived after the done marker");
        return;
      }
      if (data === "[DONE]") {
        sawDone = true;
        return;
      }
      let chunk: unknown;
      try {
        chunk = JSON.parse(data);
      } catch {
        if (strictTools) throw malformedStream("SSE data is not valid JSON");
        return;
      }
      const error = streamError(chunk, request.apiKey);
      if (error) throw error;
      if (!chunk || typeof chunk !== "object") {
        if (strictTools) throw malformedStream("SSE data is not an object");
        return;
      }
      const record = chunk as Record<string, unknown>;
      if (record.usage !== undefined) {
        if (!record.usage || typeof record.usage !== "object") {
          if (strictTools) throw malformedStream("usage is invalid");
        } else {
          const rawUsage = record.usage as Record<string, unknown>;
          const input = rawUsage.prompt_tokens ?? 0;
          const output = rawUsage.completion_tokens ?? 0;
          if (typeof input !== "number" || typeof output !== "number"
            || !Number.isFinite(input) || !Number.isFinite(output)) {
            if (strictTools) throw malformedStream("usage counters are invalid");
          } else {
            usage = { input, output };
          }
        }
      }
      if (record.choices === undefined) return;
      if (!Array.isArray(record.choices)) {
        if (strictTools) throw malformedStream("choices is not an array");
        return;
      }
      const choice = record.choices[0];
      if (!choice || typeof choice !== "object") {
        if (strictTools && record.choices.length) throw malformedStream("choice is invalid");
        return;
      }
      const choiceRecord = choice as Record<string, unknown>;
      const previousFinishReason = finishReason;
      if (choiceRecord.finish_reason !== undefined && choiceRecord.finish_reason !== null) {
        if (typeof choiceRecord.finish_reason !== "string") {
          if (strictTools) throw malformedStream("finish reason is invalid");
        } else if (previousFinishReason !== null) {
          if (strictTools) {
            throw malformedStream(previousFinishReason === choiceRecord.finish_reason
              ? "finish reason was repeated"
              : "finish reason changed during the stream");
          } else {
            finishReason = choiceRecord.finish_reason;
          }
        } else {
          finishReason = choiceRecord.finish_reason;
        }
      }
      if (choiceRecord.delta === undefined) return;
      if (!choiceRecord.delta || typeof choiceRecord.delta !== "object") {
        if (strictTools) throw malformedStream("choice delta is invalid");
        return;
      }
      const delta = choiceRecord.delta as Record<string, unknown>;
      const content = textContent(delta.content);
      if (strictTools && previousFinishReason !== null
        && (content || (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0))) {
        throw malformedStream("content arrived after the finish reason");
      }
      if (content) appendText(content);
      if (delta.tool_calls === undefined) return;
      if (!Array.isArray(delta.tool_calls)) throw malformedStream("tool calls are not an array");
      for (const toolCall of delta.tool_calls) appendToolDelta(toolCall);
    };

    const drainLines = () => {
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
      if (byteLength(buffer) > MAX_SSE_LINE_BYTES) throw malformedStream("SSE event exceeds the transport limit");
    };

    const decodeBytes = (bytes: Uint8Array) => {
      for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
        buffer += decoder.decode(bytes.subarray(offset, offset + 64 * 1024), { stream: true });
        drainLines();
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      decodeBytes(value);
      if (sawDone) {
        try {
          await reader.cancel();
        } catch {
          // The provider has already supplied a complete terminal marker.
        }
        break;
      }
    }
    buffer += decoder.decode();
    drainLines();
    if (buffer.trim()) consume(buffer.replace(/\r$/, ""));

    if (strictTools && !sawDone && finishReason === null) {
      throw malformedStream("stream disconnected before a terminal event");
    }
    const toolCalls = [...pending.values()]
      .sort((a, b) => a.index - b.index)
      .map((call): ProviderToolCall => {
        if (call.id === null) throw malformedStream(`tool call ${call.index} has no ID`);
        if (!call.name.trim()) throw malformedStream(`tool call ${call.index} has no name`);
        if (!call.argumentsJson.trim()) throw malformedStream(`tool call ${call.index} has no arguments`);
        let args: unknown;
        try {
          args = JSON.parse(call.argumentsJson);
        } catch {
          throw malformedStream(`tool call ${call.index} has invalid JSON arguments`);
        }
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          throw malformedStream(`tool call ${call.index} arguments are not an object`);
        }
        return { id: call.id, name: call.name, arguments: args as Record<string, unknown> };
      });
    if (strictTools && finishReason === "tool_calls" && toolCalls.length === 0) {
      throw malformedStream("finish reason reported tool calls but none were received");
    }
    return { text, toolCalls, usage, finishReason };
  } catch (error) {
    if (!controller.signal.aborted) controller.abort();
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be errored or aborted.
      }
    }
    if (abortKind === "caller") throw new DOMException("Aborted", "AbortError");
    if (abortKind === "timeout") throw new ProviderError("upstream_outage", "OpenRouter request timed out");
    if (error instanceof ProviderError) {
      throw new ProviderError(error.code, safeMessage(error.message, request.apiKey));
    }
    throw new ProviderError(
      "upstream_outage",
      streamStarted ? "OpenRouter stream disconnected" : "OpenRouter request failed",
    );
  } finally {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // Cancellation can release or invalidate the lock first.
      }
    }
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function createOpenRouterDriver(fetcher: typeof fetch = fetch): ProviderDriver<OpenRouterConfig> {
  return {
    driverKind: DRIVER_KIND,
    metadata: { displayName: "OpenRouter", supportsMultipleInstances: true },
    models: STATIC_MODELS,
    decodeConfig,
    defaultConfig: () => decodeConfig({}),

    async create(input: DriverCreateInput<OpenRouterConfig>): Promise<ProviderInstance> {
      const { instanceId, config } = input;
      const apiKey = input.environment[config.apiKeyEnv] ?? process.env[config.apiKeyEnv] ?? "";
      const models: ModelCatalog = structuredClone(STATIC_MODELS);
      const listeners = new Set<RuntimeEventListener>();
      const active = new Map<string, { abort: AbortController; turnId: string }>();

      const emit = (event: RuntimeEvent) => {
        for (const listener of [...listeners]) listener(event);
      };
      const base = (threadId: string, turnId: string) => ({
        eventId: newEventId(),
        provider: DRIVER_KIND,
        providerInstanceId: instanceId,
        threadId,
        turnId,
        createdAt: new Date().toISOString(),
      });

      const complete = async (
        messages: Array<{ role: string; content: string }>,
        model: string,
        opts: { stream: boolean; signal?: AbortSignal; onDelta?: (delta: string) => void },
      ): Promise<{ text: string; usage: { input: number; output: number } | null }> => {
        if (opts.stream) {
          const result = await streamOpenRouterCompletion({
            url: config.url,
            apiKey,
            model,
            messages,
            signal: opts.signal,
            onTextDelta: opts.onDelta,
          }, fetcher);
          return { text: result.text, usage: result.usage };
        }
        const response = await fetcher(`${config.url}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "x-title": "Agent Harbor",
          },
          body: JSON.stringify({ model, messages, stream: false }),
          signal: opts.signal ?? AbortSignal.timeout(DEFAULT_COMPLETION_TIMEOUT_MS),
        });
        if (!response.ok) throw await responseError(response, apiKey);
        const json = await response.json() as any;
        const error = streamError(json, apiKey);
        if (error) throw error;
        return {
          text: textContent(json.choices?.[0]?.message?.content),
          usage: json.usage
            ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
            : null,
        };
      };

      const sendTurn = async (turn: SendTurnInput) => {
        const { threadId } = turn;
        if (!apiKey) throw new Error(`OpenRouter is not configured — add a key in App Settings`);
        if (active.has(threadId)) throw new Error("a turn is already running on this thread");
        const turnId = newId();
        const abort = new AbortController();
        active.set(threadId, { abort, turnId });
        const messages = [
          ...(turn.system ? [{ role: "system", content: turn.system }] : []),
          ...(turn.transcript ?? []).map((message) => ({ role: message.role, content: message.text })),
          { role: "user", content: turn.text },
        ];
        const selectedModel = turn.model || models.default;
        appendNative(threadId, {
          dir: "out",
          source: "openrouter.chat.completions",
          msg: { model: selectedModel, messages },
        });

        emit({ ...base(threadId, turnId), type: "turn.started" });
        emit({ ...base(threadId, turnId), type: "session.started", sessionId: null, model: selectedModel });

        void (async () => {
          try {
            const { text, usage } = await complete(messages, selectedModel, {
              stream: true,
              signal: abort.signal,
              onDelta: (delta) => emit({
                ...base(threadId, turnId),
                type: "content.delta",
                streamKind: "assistant_text",
                delta,
              }),
            });
            appendNative(threadId, {
              dir: "in",
              source: "openrouter.chat.completions",
              msg: { text, usage },
            });
            if (text.trim()) emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
            if (usage) emit({ ...base(threadId, turnId), type: "thread.token-usage.updated", ...usage });
            emit({ ...base(threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
          } catch (error) {
            const aborted = error instanceof Error && error.name === "AbortError";
            if (!aborted) emit({
              ...base(threadId, turnId),
              type: "runtime.error",
              message: safeMessage(error instanceof Error ? error.message : error, apiKey),
              setup: error instanceof ProviderError && error.code === "invalid_credentials",
            });
            emit({
              ...base(threadId, turnId),
              type: "turn.completed",
              ok: false,
              stopReason: aborted ? "interrupted" : "error",
              cost: null,
            });
          } finally {
            active.delete(threadId);
          }
        })();
        return { turnId };
      };

      const snapshot = async (): Promise<ProviderSnapshot> => apiKey
        ? { state: "available", authenticated: true, version: null }
        : { state: "unavailable", reason: "OpenRouter is not configured — add a key in App Settings" };

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        displayName: input.displayName,
        enabled: input.enabled,
        models,
        refreshModels: async () => {
          if (!apiKey) return;
          const fresh = await fetchOpenRouterModels(apiKey, config.url, fetcher);
          models.default = fresh.default;
          models.options.splice(0, models.options.length, ...fresh.options);
        },
        snapshot,
        adapter: {
          provider: DRIVER_KIND,
          capabilities: {
            sessionModelSwitch: "in-session",
            contextMode: "transcript-replay",
            executionMode: "local-process",
            computerUse: "none",
          },
          sendTurn,
          interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
          respondToRequest: async () => {
            throw new Error("OpenRouter driver has no pending asks");
          },
          hasSession: (threadId) => active.has(threadId),
          stopAll: async () => {
            for (const { abort } of active.values()) abort.abort();
          },
          onEvent: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        generateText: async (prompt: string) => {
          if (!apiKey) throw new Error("OpenRouter is not configured — add a key in App Settings");
          const { text } = await complete([{ role: "user", content: prompt }], models.default, { stream: false });
          return text;
        },
        dispose: async () => {
          for (const { abort } of active.values()) abort.abort();
          active.clear();
          listeners.clear();
        },
      };
    },
  };
}

export const OpenRouterDriver = createOpenRouterDriver();
