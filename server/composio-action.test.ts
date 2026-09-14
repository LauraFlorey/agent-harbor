import { afterEach, expect, it, vi } from "vitest";
import { actionAppTools } from "./composio.ts";
import type { AppConfig } from "./config.ts";

afterEach(() => vi.unstubAllGlobals());

it("keeps account routing metadata but strips cached personal samples from discovery", async () => {
  const data = { accounts: [{ id: "account-1", status: "active", user_info: { items: [{ summary: "private event" }] } }] };
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: request.method === "tools/list" ? {
      tools: ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MULTI_EXECUTE_TOOL", "COMPOSIO_MANAGE_CONNECTIONS"].map(name => ({ name, inputSchema: { type: "object" } })),
    } : { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data } }));
  }));
  const signal = AbortSignal.timeout(1000);
  const tools = await actionAppTools({ composio: { key: "test" } } as AppConfig, signal);
  expect(tools.map(tool => tool.name)).not.toContain("COMPOSIO_MANAGE_CONNECTIONS");
  const discovery = tools.find(tool => tool.name === "COMPOSIO_SEARCH_TOOLS")!;
  const result = await discovery.execute({}, signal);
  expect(JSON.stringify(result)).toContain("account-1");
  expect(JSON.stringify(result)).not.toContain("private event");
  expect(JSON.stringify(result)).not.toContain("user_info");
  const execution = tools.find(tool => tool.name === "COMPOSIO_MULTI_EXECUTE_TOOL")!;
  expect(execution.effect).toBe("external");
  expect(JSON.stringify(await execution.execute({}, signal))).toContain("private event");
});
