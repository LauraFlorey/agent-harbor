import { expect, it } from "vitest";
import { createOpenRouterDriver } from "./openrouter.ts";
import type { RuntimeEvent } from "../contracts.ts";

async function checkMemoryHook(fail: boolean) {
  const events: RuntimeEvent[] = [];
  let archived = false;
  const driver = createOpenRouterDriver(async () => new Response('data: {"choices":[{"delta":{"content":"Jinx reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'), false, {
    kind: "jinx", displayName: "Jinx",
    afterTurn: async (turn, id, text) => {
      expect(turn.text).toBe("Remember this preference");
      expect(id).toBeTruthy();
      expect(text).toBe("Jinx reply");
      expect(events.some(event => event.type === "turn.completed")).toBe(false);
      if (fail) throw new Error("Jinx memory summary unavailable; raw exchange retained");
      archived = true;
    },
  });
  const instance = await driver.create({ instanceId: "jinx", displayName: "Jinx", enabled: true, environment: {}, config: driver.defaultConfig() });
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  instance.adapter.onEvent(event => { events.push(event); if (event.type === "turn.completed") finish(); });
  await instance.adapter.sendTurn({ threadId: "test", text: "Remember this preference" });
  await done;
  await instance.dispose();
  return { events, archived };
}

it("finishes a Jinx turn only after its memory archive is confirmed", async () => {
  const { events, archived } = await checkMemoryHook(false);
  expect(archived).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
});

it("reports a memory failure while retaining the delivered reply", async () => {
  const { events, archived } = await checkMemoryHook(true);
  expect(archived).toBe(false);
  expect(events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: "Jinx reply" }));
  expect(events).toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringContaining("raw exchange retained") }));
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
});
