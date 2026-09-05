import { describe, expect, it } from "vitest";

import {
  approvalDeadlineNs,
  beginToolCall,
  createToolTurnControl,
  DEFAULT_LOCAL_VM_TOOL_TURN_LIMITS,
  finishToolCall,
  mcpRequestDeadlineNs,
  recordToolResult,
  toolArgumentByteLimit,
  toolExecutionDeadlineNs,
  toolResultByteLimit,
  type LocalVmToolTurnLimits,
  type ToolCallBudget,
  type ToolTurnControlOwner,
  type TurnObservationEvent,
} from "./tool-turn-control.ts";

const compactLimits: LocalVmToolTurnLimits = {
  turnTimeoutMs: 5_000,
  toolCallTimeoutMs: 4_000,
  approvalWaitTimeoutMs: 3_000,
  mcpRequestTimeoutMs: 2_000,
  toolExecutionTimeoutMs: 1_000,
  maxToolCalls: 4,
  maxRepeatedCalls: 4,
  maxArgumentBytes: 16,
  maxResultBytes: 16,
  maxAggregateArgumentBytes: 64,
  maxAggregateResultBytes: 64,
  maxMcpRequests: 4,
  maxObservabilityEvents: 16,
};

function ownerWith(overrides: Partial<LocalVmToolTurnLimits> = {}): ToolTurnControlOwner {
  return createToolTurnControl({ limits: { ...compactLimits, ...overrides } });
}

describe("Local VM tool-turn operational limits", () => {
  it("publishes the reviewed default ceilings", () => {
    expect(DEFAULT_LOCAL_VM_TOOL_TURN_LIMITS).toEqual({
      turnTimeoutMs: 1_200_000,
      toolCallTimeoutMs: 90_000,
      approvalWaitTimeoutMs: 600_000,
      mcpRequestTimeoutMs: 20_000,
      toolExecutionTimeoutMs: 30_000,
      maxToolCalls: 32,
      maxRepeatedCalls: 3,
      maxArgumentBytes: 262_144,
      maxResultBytes: 2_097_152,
      maxAggregateArgumentBytes: 1_048_576,
      maxAggregateResultBytes: 8_388_608,
      maxMcpRequests: 64,
      maxObservabilityEvents: 128,
    });
    expect(Object.isFrozen(DEFAULT_LOCAL_VM_TOOL_TURN_LIMITS)).toBe(true);
  });

  it.each([
    "turnTimeoutMs",
    "toolCallTimeoutMs",
    "approvalWaitTimeoutMs",
    "mcpRequestTimeoutMs",
    "toolExecutionTimeoutMs",
    "maxToolCalls",
    "maxRepeatedCalls",
    "maxArgumentBytes",
    "maxResultBytes",
    "maxAggregateArgumentBytes",
    "maxAggregateResultBytes",
    "maxMcpRequests",
    "maxObservabilityEvents",
  ] as const)("rejects non-positive, fractional, non-finite, and unsafe %s values", (field) => {
    for (const value of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createToolTurnControl({ limits: { [field]: value } }))
        .toThrow(expect.objectContaining({ code: "closed" }));
    }
  });

  it.each([
    ["turnTimeoutMs", 1_800_001],
    ["toolCallTimeoutMs", 300_001],
    ["approvalWaitTimeoutMs", 900_001],
    ["mcpRequestTimeoutMs", 300_001],
    ["toolExecutionTimeoutMs", 300_001],
    ["maxToolCalls", 257],
    ["maxRepeatedCalls", 257],
    ["maxArgumentBytes", 262_145],
    ["maxResultBytes", 2_097_153],
    ["maxAggregateArgumentBytes", 16_777_217],
    ["maxAggregateResultBytes", 16_777_217],
    ["maxMcpRequests", 513],
    ["maxObservabilityEvents", 257],
  ] as const)("rejects oversized %s", (field, value) => {
    expect(() => createToolTurnControl({ limits: { [field]: value } }))
      .toThrow(expect.objectContaining({ code: "closed" }));
  });

  it("starts the per-call execution clock only after approval", async () => {
    const owner = ownerWith({
      turnTimeoutMs: 500,
      toolCallTimeoutMs: 30,
      approvalWaitTimeoutMs: 200,
      toolExecutionTimeoutMs: 20,
    });
    const budget = beginToolCall(owner.control, "click", "1");
    const approvalDeadline = approvalDeadlineNs(owner.control, budget, 200);
    await new Promise((resolve) => setTimeout(resolve, 45));

    expect(approvalDeadline).toBeGreaterThan(process.hrtime.bigint());
    expect(() => toolExecutionDeadlineNs(owner.control, budget)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(() => toolResultByteLimit(owner.control, budget))
      .toThrow(expect.objectContaining({ code: "timeout" }));
    owner.dispose();
  });

  it("allows every byte and count ceiling exactly, then denies the next charge", () => {
    const calls = ownerWith({
      maxToolCalls: 2,
      maxRepeatedCalls: 2,
      maxArgumentBytes: 4,
      maxAggregateArgumentBytes: 8,
      maxResultBytes: 4,
      maxAggregateResultBytes: 8,
      maxMcpRequests: 2,
    });
    expect(toolArgumentByteLimit(calls.control)).toBe(4);
    const first = beginToolCall(calls.control, "a", "1234");
    const second = beginToolCall(calls.control, "b", "5678");
    expect(toolResultByteLimit(calls.control, first)).toBe(4);
    recordToolResult(calls.control, first, 4);
    recordToolResult(calls.control, second, 4);
    mcpRequestDeadlineNs(calls.control, first);
    mcpRequestDeadlineNs(calls.control, second);
    expect(() => mcpRequestDeadlineNs(calls.control, first)).toThrow(expect.objectContaining({ code: "mcp_limit" }));
    finishToolCall(calls.control, first, "success");
    finishToolCall(calls.control, second, "success");
    calls.dispose();

    const perResult = ownerWith({ maxResultBytes: 4, maxAggregateResultBytes: 8 });
    const resultBudget = beginToolCall(perResult.control, "a", "1");
    expect(() => recordToolResult(perResult.control, resultBudget, 5))
      .toThrow(expect.objectContaining({ code: "result_limit" }));
    perResult.dispose();

    const aggregateArguments = ownerWith({
      maxToolCalls: 3,
      maxRepeatedCalls: 3,
      maxArgumentBytes: 4,
      maxAggregateArgumentBytes: 8,
    });
    beginToolCall(aggregateArguments.control, "a", "1234");
    beginToolCall(aggregateArguments.control, "b", "5678");
    expect(() => beginToolCall(aggregateArguments.control, "c", "9"))
      .toThrow(expect.objectContaining({ code: "aggregate_limit" }));
    aggregateArguments.dispose();

    const aggregateResults = ownerWith({ maxResultBytes: 4, maxAggregateResultBytes: 8 });
    const resultCalls = ["a", "b", "c"].map((name) => beginToolCall(aggregateResults.control, name, "1"));
    recordToolResult(aggregateResults.control, resultCalls[0]!, 4);
    recordToolResult(aggregateResults.control, resultCalls[1]!, 4);
    expect(() => recordToolResult(aggregateResults.control, resultCalls[2]!, 1))
      .toThrow(expect.objectContaining({ code: "aggregate_limit" }));
    aggregateResults.dispose();
  });

  it("charges call and repeat budgets atomically even under concurrent scheduling and partial failure", async () => {
    const owner = ownerWith({ maxToolCalls: 4, maxRepeatedCalls: 4 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_value, index) => Promise.resolve().then(() =>
        beginToolCall(owner.control, `tool-${index}`, "1")
      )),
    );
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(owner.lifecycleResources().activeCalls).toBe(4);
    owner.dispose();

    const retry = ownerWith({ maxToolCalls: 1, maxRepeatedCalls: 1 });
    const charged = beginToolCall(retry.control, "tool", "1");
    finishToolCall(retry.control, charged, "error");
    expect(() => beginToolCall(retry.control, "other", "2"))
      .toThrow(expect.objectContaining({ code: "tool_call_limit" }));
    retry.dispose();
  });

  it("treats canonically equivalent Unicode as the same repeated call", () => {
    const owner = ownerWith({
      maxToolCalls: 2,
      maxRepeatedCalls: 1,
      maxArgumentBytes: 64,
      maxAggregateArgumentBytes: 64,
    });
    const composed = beginToolCall(owner.control, "submit", '{"n":1,"value":"é"}');
    finishToolCall(owner.control, composed, "success");
    expect(() => beginToolCall(owner.control, "submit", '{"n":1,"value":"é"}'))
      .toThrow(expect.objectContaining({ code: "repeat_limit" }));
    owner.dispose();
  });

  it("bounds ordered telemetry, rejects async and reentrant observers, and never exposes supplied content", async () => {
    const events: TurnObservationEvent[] = [];
    const bounded = createToolTurnControl({
      limits: { ...compactLimits, maxObservabilityEvents: 2 },
      observe: (event) => events.push(event),
    });
    const budget = beginToolCall(bounded.control, "secret-tool-name", "secret-arguments");
    finishToolCall(bounded.control, budget, "success");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(Object.keys(events[0]!).sort()).toEqual(["ceiling", "counts", "decision", "elapsedMs", "limit", "sequence", "type", "value"]);
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(() => bounded.emit({ type: "state.transition", state: "cleaning" }))
      .toThrow(expect.objectContaining({ code: "observability_failure" }));
    bounded.dispose();

    const asyncObserver = createToolTurnControl({
      limits: compactLimits,
      observe: async () => {
        throw new Error("private async logger failure");
      },
    });
    expect(() => asyncObserver.emit({ type: "state.transition", state: "active" }))
      .toThrow(expect.objectContaining({ code: "observability_failure" }));
    await Promise.resolve();
    asyncObserver.dispose();

    let reentrant!: ToolTurnControlOwner;
    let nested = false;
    reentrant = createToolTurnControl({
      limits: { ...compactLimits, maxObservabilityEvents: 2 },
      observe: () => {
        if (!nested) {
          nested = true;
          reentrant.emit({ type: "state.transition", state: "active" });
        }
      },
    });
    reentrant.emit({ type: "state.transition", state: "acquiring" });
    expect(reentrant.lifecycleResources().events).toBe(2);
    expect(() => reentrant.emit({ type: "state.transition", state: "cleaning" }))
      .toThrow(expect.objectContaining({ code: "observability_failure" }));
    reentrant.dispose();

    const forgedEvents: TurnObservationEvent[] = [];
    const forged = createToolTurnControl({ limits: compactLimits, observe: (event) => forgedEvents.push(event) });
    expect(() => forged.emit({
      type: "state.transition",
      state: "active",
      rawArguments: "must-not-cross-observability-boundary",
    } as never)).toThrow(expect.objectContaining({ code: "observability_failure" }));
    expect(forgedEvents).toEqual([]);
    forged.dispose();
  });

  it("preserves the first cancellation cause and removes every owned timer and listener", () => {
    const external = new AbortController();
    const owner = createToolTurnControl({ limits: compactLimits, signal: external.signal });
    const budget: ToolCallBudget = beginToolCall(owner.control, "tool", "1");
    external.abort(new Error("raw abort identifier and secret"));
    owner.cancel("closed", "later cleanup failure");
    expect(owner.failure()).toMatchObject({ code: "aborted", message: "Local VM tool turn was cancelled" });
    expect(String(owner.failure())).not.toContain("raw abort identifier");
    finishToolCall(owner.control, budget, "aborted");
    owner.dispose();
    owner.dispose();
    expect(owner.lifecycleResources()).toEqual({ activeCalls: 0, listeners: 0, timers: 0, events: 0 });
  });
});
