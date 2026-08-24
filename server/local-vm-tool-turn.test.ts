import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { LocalVmLease } from "./local-vm-lease.ts";
import { localVmMcpEndpoint, type LocalVmMcpEndpoint } from "./local-vm-mcp.ts";
import { runLocalVmToolTurn, type LocalVmToolTurnContext } from "./local-vm-tool-turn.ts";
import {
  createApplicationToolApprovalChannel,
  type ApplicationToolApprovalDecisions,
  type ToolApprovalEvent,
} from "./tool-approval.ts";
import type { TurnObservationEvent } from "./tool-turn-control.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = join(SERVER_DIR, "testing", "fake-mcp-server.ts");
const scratch: string[] = [];

interface FakeState {
  parentPid: number;
  helperPid: number;
  methods: string[];
  toolCallNames: string[];
}

const binding = (suffix: string) => Object.freeze({
  roomId: `room-${suffix}`,
  turnId: `turn-${suffix}`,
  sessionId: `session-${suffix}`,
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fakeEndpoint(mode = "approval-tools"): Promise<{ dir: string; endpoint: LocalVmMcpEndpoint }> {
  const dir = await mkdtemp(join(tmpdir(), "agent-harbor-story5-"));
  scratch.push(dir);
  return {
    dir,
    endpoint: localVmMcpEndpoint({
      command: process.execPath,
      args: [FAKE_MCP],
      env: {
        FAKE_MCP_MODE: mode,
        FAKE_MCP_STATE_DIR: dir,
        MCP_TEST_SECRET: "story-five-turn-secret",
      },
    }),
  };
}

async function readState(dir: string): Promise<FakeState> {
  const path = join(dir, "state.json");
  const deadline = Date.now() + 5_000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return JSON.parse(await readFile(path, "utf8")) as FakeState;
}

async function assertReleased(dir: string): Promise<FakeState> {
  const state = await readState(dir);
  const deadline = Date.now() + 5_000;
  while ((alive(state.parentPid) || alive(state.helperPid)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(alive(state.parentPid)).toBe(false);
  expect(alive(state.helperPid)).toBe(false);
  expect(existsSync(join(dir, "turn-resource"))).toBe(false);
  return readState(dir);
}

function automaticApproval(): {
  channel: ReturnType<typeof createApplicationToolApprovalChannel>["channel"];
  events: ToolApprovalEvent[];
} {
  const events: ToolApprovalEvent[] = [];
  let decisions: ApplicationToolApprovalDecisions;
  const created = createApplicationToolApprovalChannel((event) => {
    events.push(event);
    if (event.type === "request.opened") {
      queueMicrotask(() => decisions.resolve({ challenge: event.challenge, behavior: "allow" }));
    }
  });
  decisions = created.decisions;
  return { channel: created.channel, events };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Local VM Story 5 turn coordinator", () => {
  it("resolves a deferred MCP endpoint only after the one authoritative lease is held", async () => {
    const fixture = await fakeEndpoint();
    const lease = new LocalVmLease(5_000);
    let factoryCalls = 0;
    await runLocalVmToolTurn({
      lease,
      binding: binding("deferred-endpoint"),
      endpoint: async () => {
        factoryCalls += 1;
        expect(lease.turnLifecycleResources().active).toBe(1);
        return fixture.endpoint;
      },
    }, async ({ tools }) => {
      expect(tools.length).toBeGreaterThan(0);
    });

    expect(factoryCalls).toBe(1);
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(fixture.dir);
  });

  it("owns the exact lease, applies the approval gate, emits redacted telemetry, and releases everything", async () => {
    const fixture = await fakeEndpoint();
    const lease = new LocalVmLease(5_000);
    Object.defineProperty(lease, "releaseTurn", {
      value: () => { throw new Error("public release method was substituted"); },
    });
    const app = automaticApproval();
    const observations: TurnObservationEvent[] = [];
    let context: LocalVmToolTurnContext | undefined;
    const exitListeners = process.listenerCount("exit");
    const secret = "never-observe-this-value";

    const result = await runLocalVmToolTurn({
      lease,
      binding: binding("success"),
      endpoint: fixture.endpoint,
      approval: app.channel,
      observe: (event) => observations.push(event),
    }, async (turn) => {
      context = turn;
      return turn.requests.execute({
        id: "raw-call-id-must-not-appear",
        name: "submit_form",
        arguments: { password: secret, note: "harmless" },
      });
    });

    expect(result).toMatchObject({ isError: false });
    expect(context?.lifecycleResources()).toEqual({
      approval: { activeCalls: 0, listeners: 0, pending: 0, timers: 0, seenCalls: 0 },
      mcp: { child: 0, listeners: 0, pending: 0, timers: 0 },
      turn: { activeCalls: 0, listeners: 0, timers: 0, events: observations.length },
      lease: { active: 0, listeners: 0, timers: 0 },
    });
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    expect(process.listenerCount("exit")).toBe(exitListeners);
    expect(observations.some((event) => event.type === "approval.outcome")).toBe(true);
    expect(observations.some((event) => event.type === "preview.refresh_requested")).toBe(true);
    expect(observations.at(-1)).toMatchObject({ type: "state.transition", state: "closed" });
    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("raw-call-id-must-not-appear");
    expect(serialized).not.toContain("submit_form");
    expect(serialized).not.toContain("room-success");
    expect(serialized).not.toContain("session-success");
    await assertReleased(fixture.dir);
  });

  it("fails closed on contention before a second child can spawn", async () => {
    const first = await fakeEndpoint();
    const second = await fakeEndpoint();
    const lease = new LocalVmLease(5_000);
    const controller = new AbortController();
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstTurn = runLocalVmToolTurn({
      lease,
      binding: binding("owner"),
      endpoint: first.endpoint,
      signal: controller.signal,
    }, async ({ signal }) => {
      firstStarted();
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    await started;

    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("contender"),
      endpoint: second.endpoint,
    }, async () => undefined)).rejects.toMatchObject({ code: "lease_contended" });
    expect(existsSync(join(second.dir, "state.json"))).toBe(false);

    controller.abort();
    await expect(firstTurn).rejects.toMatchObject({ code: "aborted" });
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(first.dir);
  });

  it("terminates repeated identical calls and aggregate result growth without extending the turn", async () => {
    const argumentsFixture = await fakeEndpoint();
    const argumentEvents: ToolApprovalEvent[] = [];
    const argumentChannel = createApplicationToolApprovalChannel((event) => argumentEvents.push(event)).channel;
    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("arguments"),
      endpoint: argumentsFixture.endpoint,
      approval: argumentChannel,
      limits: { maxArgumentBytes: 16 },
    }, async ({ requests }) => requests.execute({
      id: "oversized-arguments",
      name: "click",
      arguments: { x: 1, y: 2, padding: "reject-before-copy" },
    }))).rejects.toMatchObject({ code: "invalid_arguments" });
    expect(argumentEvents).toEqual([]);
    expect((await readState(argumentsFixture.dir)).methods).not.toContain("tools/call");
    await assertReleased(argumentsFixture.dir);

    const repeated = await fakeEndpoint();
    const repeatedLease = new LocalVmLease(5_000);
    const repeatedApp = automaticApproval();
    await expect(runLocalVmToolTurn({
      lease: repeatedLease,
      binding: binding("repeat"),
      endpoint: repeated.endpoint,
      approval: repeatedApp.channel,
      limits: { maxRepeatedCalls: 2, maxToolCalls: 4 },
    }, async ({ requests }) => {
      await requests.execute({ id: "repeat-1", name: "click", arguments: { x: 1, y: 2 } });
      await requests.execute({ id: "repeat-2", name: "click", arguments: '{"y":2,"x":1.0}' });
      await requests.execute({ id: "repeat-3", name: "click", arguments: { x: 1, y: 2 } });
    })).rejects.toMatchObject({ code: "repeat_limit" });
    expect((await readState(repeated.dir)).toolCallNames).toEqual(["click", "click"]);
    await assertReleased(repeated.dir);

    const aggregate = await fakeEndpoint();
    const aggregateApp = automaticApproval();
    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("aggregate"),
      endpoint: aggregate.endpoint,
      approval: aggregateApp.channel,
      limits: {
        maxToolCalls: 5,
        maxRepeatedCalls: 5,
        maxResultBytes: 32,
        maxAggregateResultBytes: 40,
      },
    }, async ({ requests }) => {
      for (let index = 0; index < 5; index += 1) {
        await requests.execute({ id: `aggregate-${index}`, name: "click", arguments: { x: index, y: 2 } });
      }
    })).rejects.toMatchObject({ code: "aggregate_limit" });
    expect((await readState(aggregate.dir)).toolCallNames.length).toBeLessThanOrEqual(4);
    await assertReleased(aggregate.dir);
  });

  it("uses the original monotonic deadline for provider work and approval waits", async () => {
    const provider = await fakeEndpoint();
    const startedAt = Date.now();
    let abortedAfterMs = Number.POSITIVE_INFINITY;
    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("deadline"),
      endpoint: provider.endpoint,
      limits: { turnTimeoutMs: 500 },
    }, async ({ signal }) => new Promise<never>(() => {
      signal.addEventListener("abort", () => {
        abortedAfterMs = Date.now() - startedAt;
      }, { once: true });
    }))).rejects.toMatchObject({ code: "timeout" });
    expect(abortedAfterMs).toBeLessThan(800);
    await assertReleased(provider.dir);

    const approval = await fakeEndpoint();
    const events: ToolApprovalEvent[] = [];
    const channel = createApplicationToolApprovalChannel((event) => events.push(event)).channel;
    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("approval-timeout"),
      endpoint: approval.endpoint,
      approval: channel,
      limits: { turnTimeoutMs: 500, toolCallTimeoutMs: 200, approvalWaitTimeoutMs: 20 },
    }, async ({ requests }) => requests.execute({ id: "wait", name: "click", arguments: { x: 1, y: 2 } })))
      .rejects.toMatchObject({ code: "approval_timeout" });
    expect(events.some((event) => event.type === "request.resolved" && event.reason === "timeout")).toBe(true);
    expect((await readState(approval.dir)).methods).not.toContain("tools/call");
    await assertReleased(approval.dir);
  });

  it("releases the lease and child after provider and MCP terminal failures", async () => {
    const provider = await fakeEndpoint();
    const providerLease = new LocalVmLease(5_000);
    await expect(runLocalVmToolTurn({
      lease: providerLease,
      binding: binding("provider-failure"),
      endpoint: provider.endpoint,
    }, async () => {
      throw new Error("provider failed");
    })).rejects.toThrow("provider failed");
    expect(providerLease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(provider.dir);

    const mcp = await fakeEndpoint("tool-rpc-error");
    const mcpLease = new LocalVmLease(5_000);
    const app = automaticApproval();
    await expect(runLocalVmToolTurn({
      lease: mcpLease,
      binding: binding("mcp-failure"),
      endpoint: mcp.endpoint,
      approval: app.channel,
    }, async ({ requests }) => requests.execute({ id: "mcp-failure-call", name: "click", arguments: { x: 1, y: 2 } })))
      .rejects.toMatchObject({ code: "rpc_failure" });
    expect(mcpLease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    expect((await readState(mcp.dir)).toolCallNames).toEqual([]);
    await assertReleased(mcp.dir);
  });

  it("preserves the first MCP startup failure when cleanup releases the lease", async () => {
    const startup = await fakeEndpoint("rpc-error");
    const lease = new LocalVmLease(5_000);
    await expect(runLocalVmToolTurn({
      lease,
      binding: binding("startup-failure"),
      endpoint: startup.endpoint,
    }, async () => undefined)).rejects.toMatchObject({
      code: "rpc_failure",
      reason: "initialization_failure",
      message: "Local VM MCP initialization failed",
    });
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(startup.dir);
  });

  it("propagates active and pre-cancellation through approval, MCP, and stubborn process cleanup", async () => {
    const deferredLease = new LocalVmLease(5_000);
    const deferredController = new AbortController();
    let deferredStarted!: () => void;
    const deferredReady = new Promise<void>((resolve) => {
      deferredStarted = resolve;
    });
    let endpointAborted = false;
    const deferred = runLocalVmToolTurn({
      lease: deferredLease,
      binding: binding("deferred-cancel"),
      signal: deferredController.signal,
      endpoint: async (signal) => {
        deferredStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            endpointAborted = true;
            reject(signal.reason);
          }, { once: true });
        });
      },
    }, async () => undefined);
    await deferredReady;
    deferredController.abort();
    await expect(deferred).rejects.toMatchObject({ code: "aborted" });
    expect(endpointAborted).toBe(true);
    expect(deferredLease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });

    const preCancelled = await fakeEndpoint();
    const pre = new AbortController();
    pre.abort();
    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("pre-cancel"),
      endpoint: preCancelled.endpoint,
      signal: pre.signal,
    }, async () => undefined)).rejects.toMatchObject({ code: "aborted" });
    expect(existsSync(join(preCancelled.dir, "state.json"))).toBe(false);

    const expiring = await fakeEndpoint();
    const expiringLease = new LocalVmLease(400);
    await expect(runLocalVmToolTurn({
      lease: expiringLease,
      binding: binding("lease-expiry"),
      endpoint: expiring.endpoint,
    }, async () => new Promise<never>(() => {}))).rejects.toMatchObject({ code: "aborted" });
    expect(expiringLease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(expiring.dir);

    const stubborn = await fakeEndpoint("stubborn-child");
    const controller = new AbortController();
    let context: LocalVmToolTurnContext | undefined;
    const turn = runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("cancel-race"),
      endpoint: stubborn.endpoint,
      signal: controller.signal,
    }, async (value) => {
      context = value;
      await new Promise<never>(() => {});
    });
    while (!context) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    controller.abort();
    await expect(turn).rejects.toMatchObject({ code: "aborted" });
    expect(context.lifecycleResources()).toEqual({
      approval: { activeCalls: 0, listeners: 0, pending: 0, timers: 0, seenCalls: 0 },
      mcp: { child: 0, listeners: 0, pending: 0, timers: 0 },
      turn: { activeCalls: 0, listeners: 0, timers: 0, events: expect.any(Number) },
      lease: { active: 0, listeners: 0, timers: 0 },
    });
    await assertReleased(stubborn.dir);
  });

  it("fails closed on logger failure and bounds the telemetry stream", async () => {
    const loggerFailure = await fakeEndpoint();
    const lease = new LocalVmLease(5_000);
    await expect(runLocalVmToolTurn({
      lease,
      binding: binding("logger"),
      endpoint: loggerFailure.endpoint,
      observe: (event) => {
        if (event.state === "active") throw new Error("private logger detail");
      },
    }, async () => new Promise<never>(() => {}))).rejects.toMatchObject({ code: "observability_failure" });
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(loggerFailure.dir);

    const cleanupLoggerFailure = await fakeEndpoint();
    const cleanupLease = new LocalVmLease(5_000);
    await expect(runLocalVmToolTurn({
      lease: cleanupLease,
      binding: binding("cleanup-logger"),
      endpoint: cleanupLoggerFailure.endpoint,
      observe: (event) => {
        if (event.state === "cleaning") throw new Error("cleanup logger unavailable");
      },
    }, async () => undefined)).rejects.toMatchObject({ code: "observability_failure" });
    expect(cleanupLease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
    await assertReleased(cleanupLoggerFailure.dir);

    const bounded = await fakeEndpoint();
    const observations: TurnObservationEvent[] = [];
    await expect(runLocalVmToolTurn({
      lease: new LocalVmLease(5_000),
      binding: binding("bounded-events"),
      endpoint: bounded.endpoint,
      limits: { maxObservabilityEvents: 3 },
      observe: (event) => observations.push(event),
    }, async () => undefined)).rejects.toMatchObject({ code: "observability_failure" });
    expect(observations).toHaveLength(3);
    expect(JSON.stringify(observations)).not.toContain("bounded-events");
    await assertReleased(bounded.dir);
  });
});
