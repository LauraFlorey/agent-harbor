import { describe, expect, it, vi } from "vitest";

import type { RuntimeEvent, ServerToolTurnBridge } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";
import {
  createOpenRouterDriver,
  fetchOpenRouterModels,
  streamOpenRouterCompletion,
  type OpenRouterStreamRequest,
} from "./openrouter.ts";
import {
  fragmentedToolCallSse,
  interleavedToolCallsSse,
  sequentialToolCallsSse,
} from "../testing/openrouter-sse-fixtures.ts";
import { ToolApprovalError } from "../tool-approval.ts";

const KEY = "sk-or-v1-test-secret";
const TOOL_DEFINITIONS = [{
  name: "lookup",
  description: "Look up a value",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
}];

function streamRequest(overrides: Partial<OpenRouterStreamRequest> = {}): OpenRouterStreamRequest {
  return {
    url: "https://router.test/v1",
    apiKey: KEY,
    model: "vendor/model",
    messages: [{ role: "user", content: "Use a tool" }],
    tools: TOOL_DEFINITIONS,
    ...overrides,
  };
}

function chunkedSseResponse(source: string, chunkSizes: number[] = [source.length]): Response {
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      let chunk = 0;
      while (offset < bytes.length) {
        const size = chunkSizes[chunk % chunkSizes.length] ?? bytes.length;
        controller.enqueue(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
        offset += size;
        chunk += 1;
      }
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

function singleToolCallSse(argumentsJson: string, overrides: Record<string, unknown> = {}): string {
  return [
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_shape",
            type: "function",
            function: { name: "lookup", arguments: argumentsJson },
            ...overrides,
          }],
        },
        finish_reason: "tool_calls",
      }],
    })}`,
    "data: [DONE]",
    "",
  ].join("\n");
}

async function caughtError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error rejection");
  }
  throw new Error("Expected the promise to reject");
}

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
          {
            id: "openai/gpt-5.6-terra",
            name: "Terra",
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            supported_parameters: ["tools"],
          },
          { id: "vendor/audio", name: "Audio only", architecture: { output_modalities: ["audio"] } },
          { id: "bad id", name: "Invalid" },
          { id: KEY, name: `echoed ${KEY}` },
          { id: "vendor/text-model", name: "Text Model" },
        ],
      }), { status: 200 });
    });

    expect(requestedUrl).toBe("https://router.test/v1/models/user");
    expect(authorization).toBe(`Bearer ${KEY}`);
    expect(catalog.default).toBe("openrouter/auto");
    expect(JSON.stringify(catalog)).not.toContain(KEY);
    expect(catalog.options).toEqual([
      {
        id: "openrouter/auto",
        label: "OpenRouter Auto",
        localVm: expect.objectContaining({ status: "unsupported" }),
      },
      {
        id: "openai/gpt-5.6-terra",
        label: "Terra",
        localVm: expect.objectContaining({ status: "verified", manifestRevision: expect.any(String) }),
      },
      {
        id: "vendor/text-model",
        label: "Text Model",
        localVm: expect.objectContaining({ status: "unsupported" }),
      },
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

  it("keeps duplicate catalog IDs selectable for text but revokes conflicting Terra tool metadata", async () => {
    const catalog = await fetchOpenRouterModels(KEY, undefined, async () => new Response(JSON.stringify({
      data: [
        {
          id: "openai/gpt-5.6-terra",
          name: "Terra",
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          supported_parameters: ["tools"],
        },
        {
          id: "openai/gpt-5.6-terra",
          name: "Conflicting Terra record",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          supported_parameters: [],
        },
      ],
    })));

    expect(catalog.options).toHaveLength(1);
    expect(catalog.options[0]).toMatchObject({
      id: "openai/gpt-5.6-terra",
      localVm: { status: "unknown" },
    });
  });

  it("cancels turn-time catalog verification and removes its caller listener", async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let requestAborted = false;
    const catalog = fetchOpenRouterModels(KEY, undefined, async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          requestAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }), controller.signal);

    controller.abort();
    await expect(catalog).rejects.toMatchObject({ name: "AbortError" });
    expect(requestAborted).toBe(true);
    expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("OpenRouter streamed tool-call transport", () => {
  it("maps normalized definitions and assembles fragmented UTF-8-safe calls beside text", async () => {
    let requestedUrl = "";
    let authorization = "";
    let body: any;
    const deltas: string[] = [];
    const result = await streamOpenRouterCompletion(streamRequest({
      onTextDelta: (delta) => deltas.push(delta),
    }), async (input, init) => {
      const request = new Request(input, init);
      requestedUrl = request.url;
      authorization = request.headers.get("authorization") ?? "";
      body = JSON.parse(String(init?.body));
      return chunkedSseResponse(fragmentedToolCallSse, [1, 2, 3, 5, 8]);
    });

    expect(requestedUrl).toBe("https://router.test/v1/chat/completions");
    expect(authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body).toEqual({
      model: "vendor/model",
      messages: [{ role: "user", content: "Use a tool" }],
      stream: true,
      tools: [{
        type: "function",
        function: {
          name: "lookup",
          description: "Look up a value",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      }],
    });
    expect(deltas).toEqual(["Checking café "]);
    expect(result).toEqual({
      text: "Checking café ",
      toolCalls: [{
        id: "call_weather",
        name: "get_weather",
        arguments: { city: "Montréal", unit: "c" },
      }],
      usage: { input: 17, output: 8 },
      finishReason: "tool_calls",
    });
  });

  it("serializes only provider-neutral tool fields and strips endpoint metadata", async () => {
    const tools = [{
      ...TOOL_DEFINITIONS[0],
      endpoint: { command: "/internal/local-vm-mcp", env: { SECRET: "boundary-secret" } },
      boundaryMarker: "agent-harbor-internal-boundary",
    }];
    let rawBody = "";
    await streamOpenRouterCompletion(streamRequest({ tools }), async (_input, init) => {
      rawBody = String(init?.body);
      return chunkedSseResponse('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\ndata: [DONE]\n');
    });

    expect(rawBody).not.toContain("/internal/local-vm-mcp");
    expect(rawBody).not.toContain("boundary-secret");
    expect(rawBody).not.toContain("agent-harbor-internal-boundary");
    expect(JSON.parse(rawBody).tools).toEqual([{
      type: "function",
      function: {
        name: "lookup",
        description: "Look up a value",
        parameters: TOOL_DEFINITIONS[0].inputSchema,
      },
    }]);
  });

  it("handles CRLF, blank/comments, usage-only chunks, role-only deltas, and unknown fields", async () => {
    const fixture = [
      ": keepalive",
      "",
      'data: {"choices":[{"delta":{"role":"assistant","unknown":"ignored"}}],"unknown":{"nested":true}}',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4},"provider_extra":"ignored"}',
      'data: {"choices":[{"delta":{"content":"ready"},"finish_reason":"stop","vendor":"ignored"}]}',
      "data: [DONE]",
      "",
    ].join("\r\n");
    const result = await streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(fixture, [1, 4, 2, 9]),
    );

    expect(result).toEqual({
      text: "ready",
      toolCalls: [],
      usage: { input: 9, output: 4 },
      finishReason: "stop",
    });
  });

  it("accepts terminal finish reasons followed by EOF without a done marker", async () => {
    const result = await streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse('data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n'),
    );

    expect(result).toMatchObject({ text: "complete", finishReason: "stop" });
  });

  it("keeps stable indexes while calls and text arrive interleaved", async () => {
    const result = await streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(interleavedToolCallsSse, [7, 11, 2]),
    );

    expect(result.text).toBe("I will check both. ");
    expect(result.toolCalls).toEqual([
      { id: "call_lookup", name: "lookup", arguments: { query: "harbor" } },
      { id: "call_math", name: "cal_culator", arguments: { right: 2 } },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("normalizes multiple calls delivered sequentially", async () => {
    const result = await streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(sequentialToolCallsSse),
    );

    expect(result.toolCalls).toEqual([
      { id: "call_first", name: "first", arguments: {} },
      { id: "call_second", name: "second", arguments: { ok: true } },
    ]);
  });

  it("accepts empty and nested argument objects without schema validation", async () => {
    const empty = await streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(singleToolCallSse("{}")),
    );
    expect(empty.toolCalls[0]?.arguments).toEqual({});

    const nestedArguments = {
      nested: { values: [1, true, null, { deeper: "accepted structurally" }] },
      undeclaredBySchema: 42,
    };
    const nested = await streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(singleToolCallSse(JSON.stringify(nestedArguments))),
    );
    expect(nested.toolCalls[0]?.arguments).toEqual(nestedArguments);
  });

  it.each(["[]", "null", "true", "42", '"text"'])
    ("rejects non-object argument JSON %s", async (argumentsJson) => {
      await expect(streamOpenRouterCompletion(
        streamRequest(),
        async () => chunkedSseResponse(singleToolCallSse(argumentsJson)),
      )).rejects.toThrow("arguments are not an object");
    });

  it.each([
    [
      "malformed JSON events",
      "data: not-json\ndata: [DONE]\n",
      "SSE data is not valid JSON",
    ],
    [
      "incomplete JSON arguments",
      [
        `data: ${JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"query":' },
              }],
            },
            finish_reason: "tool_calls",
          }],
        })}`,
        "data: [DONE]",
        "",
      ].join("\n"),
      "invalid JSON arguments",
    ],
    [
      "missing call IDs",
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"type":"function","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
        "",
      ].join("\n"),
      "has no ID",
    ],
    [
      "non-object arguments",
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"[]"}}]},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
        "",
      ].join("\n"),
      "arguments are not an object",
    ],
    [
      "tool finish reasons without calls",
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\ndata: [DONE]\n',
      "none were received",
    ],
  ])("rejects %s structurally without schema-validating arguments", async (_label, fixture, message) => {
    await expect(streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(fixture),
    )).rejects.toThrow(message);
  });

  it("rejects changing IDs and IDs reused by another index", async () => {
    const changing = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"look","arguments":"{"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_b","function":{"name":"up","arguments":"}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(changing)))
      .rejects.toThrow("ID changed");

    const reused = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_same","function":{"name":"one","arguments":"{}"}},{"index":1,"id":"call_same","function":{"name":"two","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(reused)))
      .rejects.toThrow("reused across indexes");
  });

  it("rejects unsafe indexes, oversized IDs, and calls without a completed name", async () => {
    const unsafeIndex = singleToolCallSse("{}", { index: Number.MAX_SAFE_INTEGER + 1 });
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(unsafeIndex)))
      .rejects.toThrow("invalid index");

    const oversizedId = singleToolCallSse("{}", { id: "i".repeat(1025) });
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(oversizedId)))
      .rejects.toThrow("ID exceeds the transport limit");

    const missingName = singleToolCallSse("{}", { function: { arguments: "{}" } });
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(missingName)))
      .rejects.toThrow("has no name");
  });

  it("accepts repeated identical finish reasons when no content follows", async () => {
    const fixture = [
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n");

    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(fixture)))
      .resolves.toMatchObject({ finishReason: "stop", text: "", toolCalls: [] });
  });

  it.each([
    [
      "conflicting finish reasons",
      [
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
        "data: [DONE]",
        "",
      ].join("\n"),
      "finish reason changed",
    ],
    [
      "content after a finish reason",
      [
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: {"choices":[{"delta":{"content":"late"}}]}',
        "data: [DONE]",
        "",
      ].join("\n"),
      "content arrived after the finish reason",
    ],
    [
      "duplicate done markers",
      "data: [DONE]\ndata: [DONE]\n",
      "data arrived after the done marker",
    ],
  ])("rejects %s", async (_label, fixture, expected) => {
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(fixture)))
      .rejects.toThrow(expected);
  });

  it("redacts provider errors and cancels the response body after parser failure", async () => {
    let canceled = 0;
    let requestSignal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: {"error":{"code":401,"message":"rejected ${KEY}"}}\n`,
        ));
      },
      cancel() {
        canceled += 1;
      },
    });

    const promise = streamOpenRouterCompletion(streamRequest(), async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Response(body);
    });
    await expect(promise).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(promise).rejects.not.toThrow(KEY);
    expect(canceled).toBe(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("bounds HTTP error bodies without exposing their contents", async () => {
    const oversized = JSON.stringify({ error: { message: `${"x".repeat(70 * 1024)}${KEY}` } });
    const promise = streamOpenRouterCompletion(
      streamRequest(),
      async () => new Response(oversized, { status: 502 }),
    );

    await expect(promise).rejects.toThrow("OpenRouter HTTP 502: OpenRouter request failed");
    await expect(promise).rejects.not.toThrow(KEY);
  });

  it("does not retain API-key-bearing request or stream failures in thrown diagnostics", async () => {
    const requestFailure = await caughtError(streamOpenRouterCompletion(
      streamRequest(),
      async () => { throw new Error(`request failed with ${KEY}`); },
    ));
    expect(requestFailure.message).toBe("OpenRouter request failed");
    expect(requestFailure.cause).toBeUndefined();
    expect(String(requestFailure.stack)).not.toContain(KEY);

    const providerFailure = await caughtError(streamOpenRouterCompletion(
      streamRequest(),
      async () => { throw new ProviderError("upstream_outage", `provider failed with ${KEY}`, {
        cause: new Error(KEY),
      }); },
    ));
    expect(providerFailure.message).toBe("provider failed with [redacted]");
    expect(providerFailure.cause).toBeUndefined();

    const unexpectedAbort = await caughtError(streamOpenRouterCompletion(
      streamRequest(),
      async () => { throw new DOMException(`unexpected abort with ${KEY}`, "AbortError"); },
    ));
    expect(unexpectedAbort.message).toBe("OpenRouter request failed");
    expect(unexpectedAbort.cause).toBeUndefined();

    const failedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(`stream failed with ${KEY}`));
      },
    });
    const streamFailure = await caughtError(streamOpenRouterCompletion(
      streamRequest(),
      async () => new Response(failedBody),
    ));
    expect(streamFailure.message).toBe("OpenRouter stream disconnected");
    expect(streamFailure.cause).toBeUndefined();
    expect(String(streamFailure.stack)).not.toContain(KEY);
  });

  it("fails closed on disconnects and invalid UTF-8", async () => {
    const disconnected = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
        ));
        controller.close();
      },
    });
    await expect(streamOpenRouterCompletion(streamRequest(), async () => new Response(disconnected)))
      .rejects.toThrow("disconnected before a terminal event");

    const invalidUtf8 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xc3, 0x28, 0x0a]));
        controller.close();
      },
    });
    await expect(streamOpenRouterCompletion(streamRequest(), async () => new Response(invalidUtf8)))
      .rejects.toThrow("OpenRouter stream disconnected");
  });

  it("bounds argument and SSE buffering", async () => {
    const oversizedArguments = "x".repeat(256 * 1024 + 1);
    const fixture = [
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_large",
              type: "function",
              function: { name: "lookup", arguments: oversizedArguments },
            }],
          },
        }],
      })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(fixture, [4096])))
      .rejects.toThrow("arguments exceed the transport limit");

    const aggregateLines = Array.from({ length: 5 }, (_, index) => `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index,
            id: `call_aggregate_${index}`,
            type: "function",
            function: { name: `tool_${index}`, arguments: JSON.stringify({ value: "x".repeat(220 * 1024) }) },
          }],
        },
      }],
    })}`);
    const aggregateFixture = [...aggregateLines, "data: [DONE]", ""].join("\n");
    await expect(streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(aggregateFixture, [8192]),
    )).rejects.toThrow("arguments exceed the transport limit");

    const tooManyCalls = Array.from({ length: 65 }, (_, index) => `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index,
            id: `call_${index}`,
            function: { name: `tool_${index}`, arguments: "{}" },
          }],
        },
      }],
    })}`).join("\n");
    await expect(streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(`${tooManyCalls}\ndata: [DONE]\n`, [4096]),
    )).rejects.toThrow("too many tool calls");

    const textFragment = "t".repeat(700 * 1024);
    const oversizedText = Array.from({ length: 3 }, () => `data: ${JSON.stringify({
      choices: [{ delta: { content: textFragment } }],
    })}`).join("\n");
    await expect(streamOpenRouterCompletion(
      streamRequest(),
      async () => chunkedSseResponse(`${oversizedText}\ndata: [DONE]\n`, [8192]),
    )).rejects.toThrow("assistant text exceeds the transport limit");

    const oversizedLine = `data: ${"x".repeat(1024 * 1024 + 1)}`;
    await expect(streamOpenRouterCompletion(streamRequest(), async () => chunkedSseResponse(oversizedLine, [8192])))
      .rejects.toThrow("SSE event exceeds the transport limit");
  });

  it("bounds the tool-definition set before issuing a request", async () => {
    const tools = Array.from({ length: 65 }, (_, index) => ({
      name: `tool_${index}`,
      inputSchema: { type: "object" },
    }));
    let fetched = false;
    await expect(streamOpenRouterCompletion(streamRequest({ tools }), async () => {
      fetched = true;
      return chunkedSseResponse("data: [DONE]\n");
    })).rejects.toThrow("too many tool definitions");
    expect(fetched).toBe(false);

    const oversized = [{
      name: "oversized",
      description: "d".repeat(1024 * 1024),
      inputSchema: { type: "object" },
    }];
    await expect(streamOpenRouterCompletion(streamRequest({ tools: oversized }), async () => {
      fetched = true;
      return chunkedSseResponse("data: [DONE]\n");
    })).rejects.toThrow("tool definitions exceed the transport limit");
    expect(fetched).toBe(false);
  });

  it("cleans up timeout and caller abort paths", async () => {
    let timeoutSignal: AbortSignal | undefined;
    const timeoutPromise = streamOpenRouterCompletion(streamRequest({ timeoutMs: 5 }), async (_input, init) => {
      timeoutSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    await expect(timeoutPromise).rejects.toThrow("OpenRouter request timed out");
    expect(timeoutSignal?.aborted).toBe(true);

    const abort = new AbortController();
    let callerSignal: AbortSignal | undefined;
    const abortPromise = streamOpenRouterCompletion(streamRequest({ signal: abort.signal }), async (_input, init) => {
      callerSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    abort.abort();
    await expect(abortPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(callerSignal?.aborted).toBe(true);
  });

  it("stops and cancels an otherwise-open body immediately after the done marker", async () => {
    let canceled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\ndata: [DONE]\n',
        ));
      },
      cancel() {
        canceled += 1;
      },
    });
    const result = await streamOpenRouterCompletion(streamRequest(), async () => new Response(body));

    expect(result.text).toBe("done");
    expect(canceled).toBe(1);
    expect(body.locked).toBe(false);
  });

  it("classifies timeout and caller-abort races by the first abort source", async () => {
    const timeoutFirstCaller = new AbortController();
    const timeoutFirst = streamOpenRouterCompletion(
      streamRequest({ signal: timeoutFirstCaller.signal, timeoutMs: 5 }),
      async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          setTimeout(() => reject(init.signal?.reason), 20);
        }, { once: true });
      }),
    );
    setTimeout(() => timeoutFirstCaller.abort(), 10);
    await expect(timeoutFirst).rejects.toThrow("OpenRouter request timed out");

    const callerFirst = new AbortController();
    const callerFirstPromise = streamOpenRouterCompletion(
      streamRequest({ signal: callerFirst.signal, timeoutMs: 10 }),
      async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          setTimeout(() => reject(init.signal?.reason), 20);
        }, { once: true });
      }),
    );
    setTimeout(() => callerFirst.abort(), 1);
    await expect(callerFirstPromise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("removes the caller listener and clears its timer after success", async () => {
    const abort = new AbortController();
    const addListener = vi.spyOn(abort.signal, "addEventListener");
    const removeListener = vi.spyOn(abort.signal, "removeEventListener");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    try {
      await streamOpenRouterCompletion(
        streamRequest({ signal: abort.signal }),
        async () => chunkedSseResponse('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\ndata: [DONE]\n'),
      );

      expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(clearTimer).toHaveBeenCalled();
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
      clearTimer.mockRestore();
    }
  });

  it("preserves tolerant text-only streaming and does not send tools", async () => {
    let body: any;
    const result = await streamOpenRouterCompletion(streamRequest({ tools: undefined }), async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return chunkedSseResponse([
        "data: not-json",
        'data: {"choices":[{"delta":{"content":"still text"},"finish_reason":"stop"}]}',
        "",
      ].join("\n"), [3, 1, 4]);
    });

    expect(body).not.toHaveProperty("tools");
    expect(result).toMatchObject({ text: "still text", toolCalls: [], finishReason: "stop" });
  });

  it("adds bounded provider-hosted web research without enabling client tool execution", async () => {
    let body: any;
    const result = await streamOpenRouterCompletion(streamRequest({
      tools: undefined,
      webResearch: {
        maxUses: 4,
        maxResults: 5,
        maxTotalResults: 12,
        searchContextSize: "low",
      },
    }), async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return chunkedSseResponse([
        'data: {"choices":[{"delta":{"content":"Grounded answer with sources."},"finish_reason":"stop"}]}',
        "data: [DONE]",
        "",
      ].join("\n"));
    });

    expect(body.tools).toEqual([{
      type: "openrouter:web_search",
      parameters: {
        engine: "auto",
        max_uses: 4,
        max_results: 5,
        max_total_results: 12,
        search_context_size: "low",
      },
    }]);
    expect(body.max_tool_calls).toBe(4);
    expect(result).toMatchObject({
      text: "Grounded answer with sources.",
      toolCalls: [],
      finishReason: "stop",
    });
  });

  it.each([
    { maxUses: 0, maxResults: 5, maxTotalResults: 12, searchContextSize: "low" },
    { maxUses: 31, maxResults: 5, maxTotalResults: 12, searchContextSize: "low" },
    { maxUses: 4, maxResults: 26, maxTotalResults: 30, searchContextSize: "low" },
    { maxUses: 4, maxResults: 5, maxTotalResults: 4, searchContextSize: "low" },
    { maxUses: 4, maxResults: 5, maxTotalResults: 12, searchContextSize: "extreme" },
  ] as const)("rejects an invalid web-research policy before sending a request", async (webResearch) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(streamOpenRouterCompletion(streamRequest({ webResearch: webResearch as never }), fetcher))
      .rejects.toThrow("web research policy is invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("OpenRouter runtime", () => {
  it("streams transcript-replay chat and usage through the provider contract", async () => {
    let chatBody: any;
    let rawChatBody = "";
    let chatHeaders: Record<string, string> = {};
    const instance = await instanceWith(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/models/user")) {
        return new Response(JSON.stringify({ data: [{ id: "vendor/model", name: "Vendor Model" }] }));
      }
      rawChatBody = String(init?.body);
      chatBody = JSON.parse(rawChatBody);
      chatHeaders = Object.fromEntries(new Headers(init?.headers).entries());
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
      options: [{
        id: "vendor/model",
        label: "Vendor Model",
        localVm: expect.objectContaining({ status: "unsupported" }),
      }],
    });
    await instance.adapter.sendTurn({
      threadId: "thread-1",
      text: "Latest",
      model: "vendor/model",
      system: "You are Harbor.",
      transcript: [{ role: "user", text: "Earlier" }, { role: "assistant", text: "Answer" }],
    });
    await terminalEvent(events);

    expect(instance.adapter.capabilities.computerUse).toBe("none");
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
    expect(chatBody).not.toHaveProperty("tools");
    expect(rawChatBody).toBe(JSON.stringify({
      model: "vendor/model",
      messages: [
        { role: "system", content: "You are Harbor." },
        { role: "user", content: "Earlier" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Latest" },
      ],
      stream: true,
    }));
    expect(chatHeaders).toEqual({
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "x-title": "Agent Harbor",
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

  it("runs only through the injected turn bridge and returns text and images for continuation", async () => {
    const bodies: any[] = [];
    const instance = await instanceWith(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return chunkedSseResponse(singleToolCallSse('{"query":"harbor"}'));
      }
      return chunkedSseResponse([
        'data: {"choices":[{"delta":{"content":"The Local VM returned a preview."},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":3}}',
        "data: [DONE]",
        "",
      ].join("\n"));
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    const controller = new AbortController();
    const executed: string[] = [];
    const bridge: ServerToolTurnBridge = {
      run: async (_turnId, signal, operation) => {
        expect(signal).not.toBe(controller.signal);
        return operation({
          tools: TOOL_DEFINITIONS,
          signal,
          execute: async (toolCall) => {
            executed.push(toolCall.name);
            return {
              callId: toolCall.id,
              content: [
                { type: "text", text: "page ready" },
                { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
              ],
              isError: false,
            };
          },
        });
      },
    };

    await instance.adapter.sendTurn({
      threadId: "thread-tools",
      text: "Inspect",
      model: "openai/gpt-5.6-terra",
      integrations: { serverToolTurn: bridge },
    });
    await terminalEvent(events);

    expect(executed).toEqual(["lookup"]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      model: "openai/gpt-5.6-terra",
      messages: [{ role: "user", content: "Inspect" }],
      tools: [{ type: "function", function: { name: "lookup" } }],
    });
    expect(bodies[1].messages).toEqual([
      { role: "user", content: "Inspect" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_shape",
          type: "function",
          function: { name: "lookup", arguments: '{"query":"harbor"}' },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_shape",
        content: [
          { type: "text", text: "page ready" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
        ],
      },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "item.started",
      itemType: "tool",
      title: "Local VM action",
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "tool", ok: true }));
    expect(events).toContainEqual(expect.objectContaining({ type: "turn.completed", ok: true }));
    await instance.dispose();
  });

  it("keeps provider web research separate from Local VM tools and removes both after denial", async () => {
    const bodies: any[] = [];
    const instance = await instanceWith(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return chunkedSseResponse(singleToolCallSse('{"query":"again"}'));
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    const bridge: ServerToolTurnBridge = {
      run: async (_turnId, signal, operation) => operation({
        tools: TOOL_DEFINITIONS,
        signal,
        execute: async () => {
          throw new ToolApprovalError("approval_denied", "private denial detail");
        },
      }),
    };

    await instance.adapter.sendTurn({
      threadId: "thread-web-and-vm-denied",
      text: "Try",
      model: "openai/gpt-5.6-terra",
      integrations: {
        serverToolTurn: bridge,
        webResearch: { maxUses: 4, maxResults: 5, maxTotalResults: 12, searchContextSize: "low" },
      },
    });
    await terminalEvent(events);

    expect(bodies).toHaveLength(2);
    expect(bodies[0].tools).toEqual([
      expect.objectContaining({ type: "openrouter:web_search" }),
      expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "lookup" }) }),
    ]);
    expect(bodies[0].max_tool_calls).toBe(4);
    expect(bodies[1]).not.toHaveProperty("tools");
    expect(bodies[1]).not.toHaveProperty("max_tool_calls");
    expect(events).toContainEqual(expect.objectContaining({ type: "turn.completed", ok: false }));
    await instance.dispose();
  });

  it("sends no tools after denial and rejects a fabricated follow-up tool call", async () => {
    const bodies: any[] = [];
    const instance = await instanceWith(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return chunkedSseResponse(singleToolCallSse('{"query":"again"}'));
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    const bridge: ServerToolTurnBridge = {
      run: async (_turnId, signal, operation) => operation({
        tools: TOOL_DEFINITIONS,
        signal,
        execute: async () => {
          throw new ToolApprovalError("approval_denied", "private denial detail");
        },
      }),
    };

    await instance.adapter.sendTurn({
      threadId: "thread-denied",
      text: "Try",
      model: "openai/gpt-5.6-terra",
      integrations: { serverToolTurn: bridge },
    });
    await terminalEvent(events);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("tools");
    expect(bodies[1]).not.toHaveProperty("tools");
    expect(events).toContainEqual(expect.objectContaining({ type: "turn.completed", ok: false }));
    expect(JSON.stringify(events)).not.toContain("private denial detail");
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
    expect(instance.adapter.hasSession("thread-cancel")).toBe(false);
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
