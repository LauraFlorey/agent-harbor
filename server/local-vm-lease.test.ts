import { describe, expect, it } from "vitest";

import {
  assertLocalVmTurnExecution,
  claimLocalVmTurnSpawn,
  LocalVmLease,
  localVmTurnLeaseBinding,
  localVmTurnLeaseSignal,
} from "./local-vm-lease.ts";

describe("LocalVmLease", () => {
  it("serializes different threads while letting the owner renew", () => {
    const lease = new LocalVmLease(100);
    const busy = () => true;

    expect(lease.claim("thread-a", "bot-a", busy, 1_000)).toBe(true);
    expect(lease.claim("thread-b", "bot-b", busy, 1_001)).toBe(false);
    expect(lease.claim("thread-a", "bot-a", busy, 1_002)).toBe(true);
    expect(lease.current(busy, 1_050)).toMatchObject({ threadId: "thread-a", botId: "bot-a" });
    lease.release("thread-a");
  });

  it("expires a wedged owner and allows recovery", () => {
    const lease = new LocalVmLease(100);
    const busy = () => true;

    lease.claim("thread-a", "bot-a", busy, 1_000);

    expect(lease.current(busy, 1_100)).toBeNull();
    expect(lease.claim("thread-b", "bot-b", busy, 1_100)).toBe(true);
    lease.release("thread-b");
  });

  it("refreshes on owner activity and releases when its bot settles", () => {
    const lease = new LocalVmLease(100);
    let ownerBusy = true;
    const busy = () => ownerBusy;

    lease.claim("thread-a", "bot-a", busy, 1_000);
    lease.touch("thread-a", 1_090);
    expect(lease.current(busy, 1_150)).not.toBeNull();

    ownerBusy = false;
    expect(lease.current(busy, 1_151)).toBeNull();
  });

  it("does not revive an expired owner from a delayed event", () => {
    const lease = new LocalVmLease(100);
    const busy = () => true;

    lease.claim("thread-a", "bot-a", busy, 1_000);
    lease.touch("thread-a", 1_100);

    expect(lease.current(busy, 1_100)).toBeNull();
    expect(lease.claim("thread-b", "bot-b", busy, 1_100)).toBe(true);
    lease.release("thread-b");
  });

  it("only lets the owning thread release the lease", () => {
    const lease = new LocalVmLease(100);
    const busy = () => true;
    lease.claim("thread-a", "bot-a", busy, 1_000);

    lease.release("thread-b");
    expect(lease.current(busy, 1_001)).not.toBeNull();
    lease.release("thread-a");
    expect(lease.current(busy, 1_002)).toBeNull();
  });

  it("binds a turn capability to the exact room, turn, and session", () => {
    const lease = new LocalVmLease(1_000);
    const binding = { roomId: "room-a", turnId: "turn-a", sessionId: "session-a" } as const;
    const handle = lease.acquireTurn(binding);

    expect(claimLocalVmTurnSpawn(handle, binding).aborted).toBe(false);
    expect(() => assertLocalVmTurnExecution(handle, { ...binding, sessionId: "session-b" }))
      .toThrow(expect.objectContaining({ code: "lease_mismatch" }));
    expect(lease.releaseTurn(handle, { ...binding, turnId: "turn-b" })).toBe(false);
    expect(lease.turnLifecycleResources()).toEqual({ active: 1, listeners: 0, timers: 1 });
    expect(lease.releaseTurn(handle, binding)).toBe(true);
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
  });

  it("snapshots the exact binding before later caller mutation", () => {
    const lease = new LocalVmLease(1_000);
    const mutable = { roomId: "room-a", turnId: "turn-a", sessionId: "session-a" };
    const handle = lease.acquireTurn(mutable);
    mutable.roomId = "room-substituted";
    mutable.turnId = "turn-substituted";
    mutable.sessionId = "session-substituted";

    expect(localVmTurnLeaseBinding(handle)).toEqual({
      roomId: "room-a",
      turnId: "turn-a",
      sessionId: "session-a",
    });
    expect(Object.isFrozen(localVmTurnLeaseBinding(handle))).toBe(true);
    expect(lease.releaseTurn(handle, localVmTurnLeaseBinding(handle))).toBe(true);
  });

  it("rejects cloned, replayed, and contending turn capabilities", () => {
    const lease = new LocalVmLease(1_000);
    const binding = { roomId: "room-a", turnId: "turn-a", sessionId: "session-a" } as const;
    const handle = lease.acquireTurn(binding);

    expect(() => lease.acquireTurn({ roomId: "room-b", turnId: "turn-b", sessionId: "session-b" }))
      .toThrow(expect.objectContaining({ code: "lease_contended" }));
    expect(() => claimLocalVmTurnSpawn(structuredClone(handle), binding))
      .toThrow(expect.objectContaining({ code: "lease_unavailable" }));
    expect(() => claimLocalVmTurnSpawn(JSON.parse(JSON.stringify(handle)), binding))
      .toThrow(expect.objectContaining({ code: "lease_unavailable" }));
    expect(() => claimLocalVmTurnSpawn(Object.create(handle), binding))
      .toThrow(expect.objectContaining({ code: "lease_unavailable" }));
    claimLocalVmTurnSpawn(handle, binding);
    expect(() => claimLocalVmTurnSpawn(handle, binding))
      .toThrow(expect.objectContaining({ code: "lease_reused" }));

    expect(lease.releaseTurn(handle, binding)).toBe(true);
    expect(lease.releaseTurn(handle, binding)).toBe(false);
    expect(() => assertLocalVmTurnExecution(handle, binding))
      .toThrow(expect.objectContaining({ code: "lease_unavailable" }));
  });

  it("enforces one global Local VM fence across independent lease managers", () => {
    const first = new LocalVmLease(1_000);
    const second = new LocalVmLease(1_000);
    const binding = { roomId: "room-a", turnId: "turn-a", sessionId: "session-a" } as const;
    const handle = first.acquireTurn(binding);

    expect(() => second.acquireTurn({ roomId: "room-b", turnId: "turn-b", sessionId: "session-b" }))
      .toThrow(expect.objectContaining({ code: "lease_contended" }));
    expect(second.claim("thread-b", "bot-b", () => true)).toBe(false);
    expect(second.releaseTurn(handle, binding)).toBe(false);
    expect(first.releaseTurn(handle, binding)).toBe(true);

    expect(second.claim("thread-b", "bot-b", () => true, 1_000)).toBe(true);
    expect(() => first.acquireTurn(binding)).toThrow(expect.objectContaining({ code: "lease_contended" }));
    second.release("thread-b");
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, 86_400_001])(
    "rejects unsafe lease TTL %s",
    (ttl) => {
      expect(() => new LocalVmLease(ttl)).toThrow("Local VM lease TTL is outside the safety limit");
    },
  );

  it("expires monotonically and aborts stale ownership", async () => {
    const lease = new LocalVmLease(20);
    const binding = { roomId: "room-a", turnId: "turn-a", sessionId: "session-a" } as const;
    const handle = lease.acquireTurn(binding);
    const signal = localVmTurnLeaseSignal(handle, binding);
    claimLocalVmTurnSpawn(handle, binding);

    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toMatchObject({ code: "lease_expired" });
    expect(lease.turnLifecycleResources()).toEqual({ active: 1, listeners: 0, timers: 0 });
    expect(() => assertLocalVmTurnExecution(handle, binding))
      .toThrow(expect.objectContaining({ code: "lease_expired" }));
    expect(() => lease.acquireTurn({ roomId: "room-b", turnId: "turn-b", sessionId: "session-b" }))
      .toThrow(expect.objectContaining({ code: "lease_contended" }));
    expect(lease.releaseTurn(handle, binding)).toBe(true);

    const replacement = lease.acquireTurn({ roomId: "room-b", turnId: "turn-b", sessionId: "session-b" });
    expect(replacement).not.toBe(handle);
    expect(lease.releaseTurn(replacement, { roomId: "room-b", turnId: "turn-b", sessionId: "session-b" })).toBe(true);
  });

  it("fails closed on pre-cancellation and retains an active fence until cleanup", () => {
    const lease = new LocalVmLease(1_000);
    const controller = new AbortController();
    const binding = { roomId: "room-a", turnId: "turn-a", sessionId: "session-a" } as const;
    controller.abort();
    expect(() => lease.acquireTurn(binding, controller.signal))
      .toThrow(expect.objectContaining({ code: "lease_unavailable" }));

    const activeController = new AbortController();
    const handle = lease.acquireTurn(binding, activeController.signal);
    const signal = localVmTurnLeaseSignal(handle, binding);
    activeController.abort();
    expect(signal.aborted).toBe(false);
    expect(lease.turnLifecycleResources()).toEqual({ active: 1, listeners: 0, timers: 1 });
    expect(lease.releaseTurn(handle, binding)).toBe(true);
    expect(lease.turnLifecycleResources()).toEqual({ active: 0, listeners: 0, timers: 0 });
  });

  it("rejects accessor, prototype, and extra-field binding substitution without invoking accessors", () => {
    const lease = new LocalVmLease(1_000);
    let reads = 0;
    const accessor = {
      get roomId() {
        reads += 1;
        return "room-a";
      },
      turnId: "turn-a",
      sessionId: "session-a",
    };
    expect(() => lease.acquireTurn(accessor)).toThrow(expect.objectContaining({ code: "lease_mismatch" }));
    expect(reads).toBe(0);

    const inherited = Object.create({ roomId: "room-a" }) as {
      roomId: string;
      turnId: string;
      sessionId: string;
    };
    inherited.turnId = "turn-a";
    inherited.sessionId = "session-a";
    expect(() => lease.acquireTurn(inherited)).toThrow(expect.objectContaining({ code: "lease_mismatch" }));
    expect(() => lease.acquireTurn({
      roomId: "room-a",
      turnId: "turn-a",
      sessionId: "session-a",
      extra: "substitution",
    } as never)).toThrow(expect.objectContaining({ code: "lease_mismatch" }));
  });
});
