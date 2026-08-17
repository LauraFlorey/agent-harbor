import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";
import { createOpenRouterDriver, fetchOpenRouterModels } from "./openrouter.ts";

const KEY = "sk-or-v1-test-secret";

function instanceWith(fetcher: typeof fetch) {
  const driver = createOpenRouterDriver(fetcher);
  return driver.create({
    instanceId: "openrouter-test",
    displayName: "OpenRouter",
    environment: { OPENROUTER_API_KEY: KEY },
    enabled: true,
    config: driver.defaultConfig(),
  });
}

function terminalEvent(events: RuntimeEvent[]) {
  return new Promise<RuntimeEvent>((resolve) => {
    const existing = events.find((event) => event.type === "turn.completed");
    if (existing) resolve(existing);
    const timer = setInterval(() => {
      const event = events.find((candidate) => candidate.type === "turn.completed");
      if (!event) return;
      clearInterval(timer);
      resolve(event);
    }, 2);
  });
}

describe("OpenRouter model catalog", () => {
  it("uses the account-filtered endpoint and keeps text-capable models", async () => {
    let requestedUrl = "";
    let authorization = "";
    const catalog = await fetchOpenRouterModels(KEY, "https://router.test/v1/", async (input, init) => {
      const request = new Request(input, init);
      requestedUrl = request.url;
      authorization = request.headers.get("authorization") ?? "";
      return new Response(JSON.stringify({
        data: [
          { id: "openrouter/auto", name: "OpenRouter Auto", architecture: { output_modalities: ["text"] } },
          { id: "vendor/audio", name: "Audio only", architecture: { output_modalities: ["audio"] } },
          { id: "bad id", name: "Invalid" },
          { id: "vendor/text-model", name: "Text Model" },
        ],
      }), { status: 200 });
    });

    expect(requestedUrl).toBe("https://router.test/v1/models/user");
    expect(authorization).toBe(`Bearer ${KEY}`);
    expect(catalog.default).toBe("openrouter/auto");
    expect(catalog.options).toEqual([
      { id: "openrouter/auto", label: "OpenRouter Auto" },
      { id: "vendor/text-model", label: "Text Model" },
    ]);
  });

  it("classifies rejected credentials without including the key", async () => {
    await expect(fetchOpenRouterModels(KEY, undefined, async () => new Response(JSON.stringify({
      error: { message: `bad key ${KEY}` },
    }), { status: 401 }))).rejects.toMatchObject({
      name: "ProviderError",
      code: "invalid_credentials",
    } satisfies Partial<ProviderError>);

    await expect(fetchOpenRouterModels(KEY, undefined, async () => new Response(JSON.stringify({
      error: { message: `bad key ${KEY}` },
    }), { status: 401 }))).rejects.not.toThrow(KEY);
  });
});

describe("OpenRouter runtime", () => {
  it("streams transcript-replay chat and usage through the provider contract", async () => {
    let chatBody: any;
    const instance = await instanceWith(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/models/user")) {
        return new Response(JSON.stringify({ data: [{ id: "vendor/model", name: "Vendor Model" }] }));
      }
      chatBody = JSON.parse(String(init?.body));
      return new Response([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}',
        'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Laura"}]}}]}',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":2}}',
        "data: [DONE]",
        "",
      ].join("\n"), { headers: { "content-type": "text/event-stream" } });
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));

    await instance.refreshModels?.();
    expect(instance.models).toEqual({
      default: "vendor/model",
      options: [{ id: "vendor/model", label: "Vendor Model" }],
    });
    await instance.adapter.sendTurn({
      threadId: "thread-1",
      text: "Latest",
      model: "vendor/model",
      system: "You are Harbor.",
      transcript: [{ role: "user", text: "Earlier" }, { role: "assistant", text: "Answer" }],
    });
    await terminalEvent(events);

    expect(chatBody).toMatchObject({
      model: "vendor/model",
      stream: true,
      messages: [
        { role: "system", content: "You are Harbor." },
        { role: "user", content: "Earlier" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Latest" },
      ],
    });
    expect(events.filter((event) => event.type === "content.delta").map((event: any) => event.delta).join(""))
      .toBe("Hello Laura");
    expect(events).toContainEqual(expect.objectContaining({
      type: "thread.token-usage.updated",
      input: 12,
      output: 2,
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: "turn.completed", ok: true }));
    await instance.dispose();
  });

  it("surfaces mid-stream OpenRouter errors and redacts the key", async () => {
    const instance = await instanceWith(async () => new Response([
      'data: {"choices":[{"delta":{"content":"partial"}}]}',
      `data: {"error":{"code":401,"message":"rejected ${KEY}"}}`,
      "",
    ].join("\n"), { headers: { "content-type": "text/event-stream" } }));
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));

    await instance.adapter.sendTurn({ threadId: "thread-error", text: "Hello" });
    await terminalEvent(events);

    const error = events.find((event) => event.type === "runtime.error");
    expect(error).toMatchObject({ type: "runtime.error", setup: true });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(events).toContainEqual(expect.objectContaining({ type: "turn.completed", ok: false, stopReason: "error" }));
    await instance.dispose();
  });

  it("cancels an in-flight request", async () => {
    const instance = await instanceWith(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));

    const { turnId } = await instance.adapter.sendTurn({ threadId: "thread-cancel", text: "Wait" });
    await instance.adapter.interruptTurn("thread-cancel", turnId);
    await terminalEvent(events);

    expect(events).not.toContainEqual(expect.objectContaining({ type: "runtime.error" }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "turn.completed",
      ok: false,
      stopReason: "interrupted",
    }));
    await instance.dispose();
  });
});
