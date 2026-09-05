import { describe, expect, it } from "vitest";

import {
  providerSupportsLocalVm,
  type ProviderAdapter,
  type ProviderToolCall,
  type ProviderToolDefinition,
  type ProviderToolResult,
} from "./contracts.ts";

describe("provider-neutral tool contract", () => {
  it("represents normalized tool definitions, calls, and multimodal results", () => {
    const definition: ProviderToolDefinition = {
      name: "get_desktop_state",
      description: "Inspect the isolated desktop",
      inputSchema: { type: "object", properties: {} },
    };
    const call: ProviderToolCall = {
      id: "call-1",
      name: definition.name,
      arguments: {},
    };
    const result: ProviderToolResult = {
      callId: call.id,
      content: [
        { type: "text", text: "Desktop ready" },
        { type: "image", data: "base64-data", mimeType: "image/png" },
      ],
      isError: false,
    };

    expect({ definition, call, result }).toEqual({
      definition: {
        name: "get_desktop_state",
        description: "Inspect the isolated desktop",
        inputSchema: { type: "object", properties: {} },
      },
      call: { id: "call-1", name: "get_desktop_state", arguments: {} },
      result: {
        callId: "call-1",
        content: [
          { type: "text", text: "Desktop ready" },
          { type: "image", data: "base64-data", mimeType: "image/png" },
        ],
        isError: false,
      },
    });
  });

  it("routes MCP and server-driven local processes to the Local VM", () => {
    const capabilities = (
      computerUse: ProviderAdapter["capabilities"]["computerUse"],
      executionMode: ProviderAdapter["capabilities"]["executionMode"] = "local-process",
    ) => ({ computerUse, executionMode });

    expect(providerSupportsLocalVm(capabilities("mcp"))).toBe(true);
    expect(providerSupportsLocalVm(capabilities("server"))).toBe(true);
    expect(providerSupportsLocalVm(capabilities("none"))).toBe(false);
    expect(providerSupportsLocalVm(capabilities("native", "remote-computer"))).toBe(false);
    expect(providerSupportsLocalVm(capabilities("server", "remote-computer"))).toBe(false);
  });
});
