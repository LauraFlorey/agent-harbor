import { afterEach, describe, expect, it, vi } from "vitest";

import { recordEvents } from "../testing/events.ts";
import { GrokDriver } from "./grok.ts";

describe("Grok API error handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not surface an upstream response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "account secret and echoed prompt" }), { status: 401 }),
      ),
    );
    const instance = await GrokDriver.create({
      instanceId: "grok-test",
      displayName: "Grok Test",
      environment: { XAI_API_KEY: "test-key" },
      enabled: true,
      config: { url: "https://example.invalid", apiKeyEnv: "XAI_API_KEY" },
    });
    const recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "thread-1", text: "hello" });
    await recorder.until((event) => event.type === "turn.completed");

    const error = recorder.events.find((event) => event.type === "runtime.error");
    expect(error).toMatchObject({ message: "xAI HTTP 401" });
    expect(JSON.stringify(recorder.events)).not.toContain("account secret");
    recorder.stop();
    await instance.dispose();
  });
});
