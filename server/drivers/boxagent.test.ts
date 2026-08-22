// Concurrency guard: the prompt POST is async, so the thread reservation
// must exist before it — otherwise two overlapping sendTurns both pass the
// "already running" check and queue two paid box runs. fetch is stubbed;
// no box is ever contacted.
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordEvents } from "../testing/events.ts";
import { BoxAgentDriver } from "./boxagent.ts";

const createInstance = () =>
  BoxAgentDriver.create({
    instanceId: "computer",
    displayName: "Computer",
    environment: { BOX_TOKEN: "test-token" },
    enabled: true,
    config: { pollMs: 5 },
  });

const turn = {
  threadId: "thread-1",
  text: "hi",
  integrations: { computer: { boxId: "box-1", token: "t" } },
};

describe("BoxAgentDriver turn guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a second sendTurn while the prompt POST is still in flight", async () => {
    let promptPosts = 0;
    let releasePrompt!: () => void;
    const promptMayFinish = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST" && url.endsWith("/prompt")) {
          promptPosts += 1;
          await promptMayFinish;
          return new Response(JSON.stringify({ ok: true, promptRun: { id: "run-1" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200 });
      }),
    );

    const instance = await createInstance();
    const recorder = recordEvents(instance.adapter);
    const first = instance.adapter.sendTurn(turn);
    await vi.waitFor(() => expect(promptPosts).toBe(1));
    await expect(instance.adapter.sendTurn(turn)).rejects.toThrow("already running");
    releasePrompt();
    await first;
    expect(promptPosts).toBe(1);
    await instance.adapter.stopAll();
    await recorder.until((event) => event.type === "turn.completed");
    recorder.stop();
  });

  it("frees the thread again when the prompt POST fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "box_down" }), { status: 502 })),
    );

    const instance = await createInstance();
    await expect(instance.adapter.sendTurn(turn)).rejects.toThrow("box_down");
    // the reservation was released — this fails as box_down, not "already running"
    await expect(instance.adapter.sendTurn(turn)).rejects.toThrow("box_down");
    await instance.adapter.stopAll();
  });
});
