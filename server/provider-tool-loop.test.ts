import { describe, expect, it } from "vitest";

import type { ProviderToolCall, ProviderToolResult } from "./contracts.ts";
import { providerSafeToolResult, runProviderToolLoop } from "./provider-tool-loop.ts";
import { ToolApprovalError } from "./tool-approval.ts";

const call: ProviderToolCall = { id: "call-1", name: "screenshot", arguments: {} };
const result: ProviderToolResult = {
  callId: call.id,
  content: [{ type: "text", text: "visible page" }],
  isError: false,
};

describe("provider-neutral tool continuation loop", () => {
  it("replaces MCP failure details and mismatched result identities before continuation", () => {
    const failure = providerSafeToolResult(call, {
      callId: "wrong-call",
      content: [{ type: "text", text: "internal socket error with secret" }],
      isError: true,
    });
    expect(failure).toEqual({
      callId: "call-1",
      content: [{ type: "text", text: "The Local VM action failed." }],
      isError: true,
    });
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("returns matching sequential results and retains one signal across continuations", async () => {
    const controller = new AbortController();
    const requests: any[] = [];
    const completed = [
      { text: "Checking", toolCalls: [call], finishReason: "tool_calls", usage: { input: 2, output: 1 } },
      { text: "The page is visible.", toolCalls: [], finishReason: "stop", usage: { input: 3, output: 2 } },
    ];
    const output = await runProviderToolLoop({
      messages: [{ role: "user", content: "Inspect" }],
      tools: [{ name: call.name, inputSchema: { type: "object" } }],
      signal: controller.signal,
      complete: async (request) => {
        requests.push(request);
        return completed.shift()!;
      },
      execute: async () => result,
    });

    expect(output).toEqual({
      text: "Checking\n\nThe page is visible.",
      usage: { input: 5, output: 3 },
      denied: false,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].signal).toBe(controller.signal);
    expect(requests[1].signal).toBe(controller.signal);
    expect(requests[1].messages).toContainEqual({ role: "tool", result });
  });

  it("allows only one tool-free continuation after an explicit denial", async () => {
    const requests: any[] = [];
    const output = await runProviderToolLoop({
      messages: [{ role: "user", content: "Act" }],
      tools: [{ name: call.name, inputSchema: { type: "object" } }],
      signal: new AbortController().signal,
      complete: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? { text: "", toolCalls: [call], finishReason: "tool_calls", usage: null }
          : { text: "I did not take the screenshot.", toolCalls: [], finishReason: "stop", usage: null };
      },
      execute: async () => { throw new ToolApprovalError("approval_denied", "private detail"); },
    });

    expect(output).toMatchObject({ denied: true, text: "I did not take the screenshot." });
    expect(requests[1].tools).toEqual([]);
    expect(requests[1].messages).toContainEqual({
      role: "tool",
      result: {
        callId: "call-1",
        content: [{ type: "text", text: "Denied by the user." }],
        isError: true,
      },
    });
  });

  it("handles sibling calls sequentially with an independent decision after a partial denial", async () => {
    const sibling = { ...call, id: "call-2", name: "click" };
    const executed: string[] = [];
    const requests: any[] = [];
    const output = await runProviderToolLoop({
      messages: [{ role: "user", content: "Act twice" }],
      tools: [
        { name: call.name, inputSchema: { type: "object" } },
        { name: sibling.name, inputSchema: { type: "object" } },
      ],
      signal: new AbortController().signal,
      complete: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? { text: "", toolCalls: [call, sibling], finishReason: "tool_calls", usage: null }
          : { text: "I stopped after the denial.", toolCalls: [], finishReason: "stop", usage: null };
      },
      execute: async (toolCall) => {
        executed.push(toolCall.id);
        if (toolCall.id === "call-1") throw new ToolApprovalError("approval_denied", "denied");
        return { ...result, callId: toolCall.id };
      },
    });

    expect(executed).toEqual(["call-1", "call-2"]);
    expect(output).toMatchObject({ denied: true, text: "I stopped after the denial." });
    expect(requests[1].messages).toContainEqual({
      role: "tool",
      result: {
        callId: "call-2",
        content: [{ type: "text", text: "visible page" }],
        isError: false,
      },
    });
  });

  it("rejects another tool request after denial and propagates cancellation without continuation", async () => {
    let calls = 0;
    await expect(runProviderToolLoop({
      messages: [{ role: "user", content: "Act" }],
      tools: [{ name: call.name, inputSchema: { type: "object" } }],
      signal: new AbortController().signal,
      complete: async () => ({ text: "", toolCalls: [call], finishReason: "tool_calls", usage: null }),
      execute: async () => {
        calls += 1;
        throw new ToolApprovalError("approval_denied", "denied");
      },
    })).rejects.toThrow("requested another tool");
    expect(calls).toBe(1);

    const controller = new AbortController();
    controller.abort();
    await expect(runProviderToolLoop({
      messages: [],
      tools: [],
      signal: controller.signal,
      complete: async () => { throw new Error("must not run"); },
      execute: async () => result,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
