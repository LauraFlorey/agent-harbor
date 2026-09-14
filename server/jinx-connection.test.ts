import { expect, it } from "vitest";
import { decodeJinxConnection, jinxRequest } from "./jinx-connection.ts";

it("validates SSH destinations and keeps remote paths as a single argument", () => {
  expect(decodeJinxConnection({ host: "jinx-mini", root: "/Users/owner/Jinx System/" })).toEqual({ host: "jinx-mini", root: "/Users/owner/Jinx System" });
  for (const host of ["-oProxyCommand=x", "jinx;echo x", "jinx mini", "$(whoami)"]) {
    expect(() => decodeJinxConnection({ host, root: "/tmp/jinx" })).toThrow();
  }
  expect(() => decodeJinxConnection({ host: "jinx-mini", root: "relative" })).toThrow();
});

it("refuses unknown routes before opening an SSH connection", async () => {
  await expect(jinxRequest({ host: "no-such-host", root: "/tmp/jinx" }, "/arbitrary-command")).rejects.toThrow("Unknown");
});

it("does not open a connection after cancellation", () => {
  const abort = new AbortController(); abort.abort();
  expect(() => jinxRequest({ host: "no-such-host", root: "/tmp/jinx" }, "/status", undefined, abort.signal)).toThrow();
});

it("bounds accumulated Jinx images while preserving the latest image and tool identifiers", async () => {
  const { boundJinxImages } = await import("./jinx-connection.ts");
  const messages = [0, 1, 2].map(i => ({ role: "tool", tool_call_id: `image-${i}`, content: [{ type: "text", text: `Page ${i + 1}` }, { type: "image_url", image_url: { url: "data:image/jpeg;base64," + "a".repeat(750_000) } }] }));
  const bounded = boundJinxImages({ messages }) as { messages: typeof messages };
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThan(1_650_000);
  expect(bounded.messages[0].tool_call_id).toBe("image-0");
  expect(bounded.messages[0].content[1].type).toBe("text");
  expect(bounded.messages[2].content[1].type).toBe("image_url");
  expect(messages[0].content[1].type).toBe("image_url");
});
