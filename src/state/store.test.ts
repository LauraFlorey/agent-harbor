import { describe, expect, it } from "vitest";
import { initialState, reducer, type Bot } from "./store";

const imported: Bot = {
  id: "imported-bot",
  threadId: "imported-thread",
  name: "Imported QA bot",
  title: "",
  description: "",
  notifications: false,
  color: "blue",
  unread: false,
  modelSelection: { instanceId: "test", model: "test" },
  messages: [],
};

describe("team import delivery", () => {
  it.each(["event-first", "response-first"] as const)(
    "keeps one bot when the live event and HTTP response arrive %s",
    (order) => {
      const existing = { ...imported, id: "existing-bot" };
      const start = { ...initialState, bots: [existing], selectedId: existing.id };
      const event = { type: "botPatched" as const, bot: imported };
      const response = { type: "botAdded" as const, bot: imported };
      const deliveries = order === "event-first" ? [event, response] : [response, event];
      const result = deliveries.reduce(reducer, start);

      expect(result.bots.map((bot) => bot.id)).toEqual([imported.id, existing.id]);
      expect(result.selectedId).toBe(imported.id);
      expect(result.bots[0]).toEqual(imported);
    },
  );
});
