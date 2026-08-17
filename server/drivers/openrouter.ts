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
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId, ProviderError } from "../contracts.ts";
import { appendNative } from "./native.ts";

const DRIVER_KIND = "openrouter";
const DEFAULT_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/auto";
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
  try {
    body = await response.json() as OpenRouterErrorBody;
  } catch {
    // Some upstream failures return HTML or an empty response. Do not echo it.
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
        const response = await fetcher(`${config.url}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "x-title": "Agent Harbor",
          },
          body: JSON.stringify({ model, messages, stream: opts.stream }),
          signal: opts.signal ?? AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw await responseError(response, apiKey);
        if (!opts.stream) {
          const json = await response.json() as any;
          const error = streamError(json, apiKey);
          if (error) throw error;
          return {
            text: textContent(json.choices?.[0]?.message?.content),
            usage: json.usage
              ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
              : null,
          };
        }
        if (!response.body) throw new ProviderError("upstream_outage", "OpenRouter returned an empty stream");
        let text = "";
        let usage: { input: number; output: number } | null = null;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const consume = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) return;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") return;
          let chunk: any;
          try {
            chunk = JSON.parse(data);
          } catch {
            return;
          }
          const error = streamError(chunk, apiKey);
          if (error) throw error;
          const delta = textContent(chunk.choices?.[0]?.delta?.content);
          if (delta) {
            text += delta;
            opts.onDelta?.(delta);
          }
          if (chunk.usage) {
            usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            consume(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
        return { text, usage };
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
