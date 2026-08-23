const MAX_BINDING_BYTES = 256;
const MAX_LEASE_TTL_MS = 24 * 60 * 60_000;
const SAFE_BINDING = /^[\x21-\x7e]+$/;

export interface LocalVmLeaseRecord {
  threadId: string;
  botId: string;
  expiresAt: number;
}

export interface LocalVmTurnBinding {
  readonly roomId: string;
  readonly turnId: string;
  readonly sessionId: string;
}

/** Opaque application-owned capability. A plain object or structured clone
 * cannot acquire, release, spawn from, or execute against the Local VM. */
export interface LocalVmTurnLeaseHandle {
  readonly kind: "application-local-vm-turn-lease";
}

type LeaseFailureCode =
  | "lease_contended"
  | "lease_expired"
  | "lease_mismatch"
  | "lease_reused"
  | "lease_unavailable";

export class LocalVmLeaseError extends Error {
  readonly code: LeaseFailureCode;

  constructor(code: LeaseFailureCode, message: string) {
    super(message);
    this.name = "LocalVmLeaseError";
    this.code = code;
  }
}

interface LegacyLeaseState {
  kind: "legacy";
  owner: LocalVmLease;
  record: LocalVmLeaseRecord;
}

interface TurnLeaseState {
  kind: "turn";
  owner: LocalVmLease;
  binding: LocalVmTurnBinding;
  handle: LocalVmTurnLeaseHandle;
  controller: AbortController;
  expiresAtNs: bigint;
  timer: ReturnType<typeof setTimeout>;
  active: boolean;
  expired: boolean;
  spawnClaimed: boolean;
  expire: () => void;
}

type ActiveLease = LegacyLeaseState | TurnLeaseState;
const turnLeaseStates = new WeakMap<LocalVmTurnLeaseHandle, TurnLeaseState>();
let globalActiveLease: ActiveLease | null = null;

function clearTurnState(
  state: TurnLeaseState,
  reason: string,
  code: "lease_expired" | "lease_unavailable",
): void {
  if (!state.active) return;
  state.active = false;
  if (globalActiveLease === state) globalActiveLease = null;
  clearTimeout(state.timer);
  if (!state.controller.signal.aborted) state.controller.abort(new LocalVmLeaseError(code, reason));
}

function boundedBinding(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_BINDING_BYTES &&
    SAFE_BINDING.test(value);
}

function normalizeBinding(binding: LocalVmTurnBinding): LocalVmTurnBinding {
  try {
    if (!binding || typeof binding !== "object") throw new Error("invalid");
    const prototype = Object.getPrototypeOf(binding);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid");
    const descriptors = Object.getOwnPropertyDescriptors(binding);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 3 ||
      !keys.every((key) => typeof key === "string" && ["roomId", "turnId", "sessionId"].includes(key))
    ) throw new Error("invalid");
    const read = (key: keyof LocalVmTurnBinding): string => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor) || !boundedBinding(descriptor.value)) {
        throw new Error("invalid");
      }
      return descriptor.value;
    };
    return Object.freeze({
      roomId: read("roomId"),
      turnId: read("turnId"),
      sessionId: read("sessionId"),
    });
  } catch {
    throw new LocalVmLeaseError("lease_mismatch", "Local VM lease binding is invalid");
  }
}

function exactBinding(left: LocalVmTurnBinding, right: LocalVmTurnBinding): boolean {
  return left.roomId === right.roomId && left.turnId === right.turnId && left.sessionId === right.sessionId;
}

function monotonicNow(): bigint {
  return process.hrtime.bigint();
}

/** A short, renewable ownership fence for the one shared Local VM desktop.
 * Legacy thread claims remain intact for existing engines. Server-owned tool
 * turns use an opaque, exact-binding capability with monotonic expiry. */
export class LocalVmLease {
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LEASE_TTL_MS) {
      throw new Error("Local VM lease TTL is outside the safety limit");
    }
    this.ttlMs = ttlMs;
  }

  current(isBotBusy: (botId: string) => boolean, now = Date.now()): LocalVmLeaseRecord | null {
    if (globalActiveLease?.kind === "legacy") {
      if (globalActiveLease.record.expiresAt <= now || !isBotBusy(globalActiveLease.record.botId)) {
        globalActiveLease = null;
      }
      return globalActiveLease?.kind === "legacy" ? { ...globalActiveLease.record } : null;
    }
    if (globalActiveLease?.kind === "turn") {
      const remainingNs = globalActiveLease.expiresAtNs - monotonicNow();
      if (remainingNs <= 0n) globalActiveLease.expire();
      return {
        threadId: globalActiveLease.binding.roomId,
        botId: globalActiveLease.binding.sessionId,
        expiresAt: now + Math.max(0, Math.ceil(Number(remainingNs) / 1_000_000)),
      };
    }
    return null;
  }

  claim(
    threadId: string,
    botId: string,
    isBotBusy: (ownerBotId: string) => boolean,
    now = Date.now(),
  ): boolean {
    const current = this.current(isBotBusy, now);
    if (
      current &&
      (globalActiveLease?.kind !== "legacy" || globalActiveLease.owner !== this || current.threadId !== threadId)
    ) return false;
    globalActiveLease = { kind: "legacy", owner: this, record: { threadId, botId, expiresAt: now + this.ttlMs } };
    return true;
  }

  touch(threadId: string, now = Date.now()): void {
    if (globalActiveLease?.kind !== "legacy" || globalActiveLease.owner !== this) return;
    if (globalActiveLease.record.expiresAt <= now) {
      globalActiveLease = null;
      return;
    }
    if (globalActiveLease.record.threadId === threadId) globalActiveLease.record.expiresAt = now + this.ttlMs;
  }

  release(threadId: string): void {
    if (
      globalActiveLease?.kind === "legacy" &&
      globalActiveLease.owner === this &&
      globalActiveLease.record.threadId === threadId
    ) globalActiveLease = null;
  }

  acquireTurn(binding: LocalVmTurnBinding, signal?: AbortSignal): LocalVmTurnLeaseHandle {
    const normalizedBinding = normalizeBinding(binding);
    if (signal?.aborted) {
      throw new LocalVmLeaseError("lease_unavailable", "Local VM turn was cancelled before lease acquisition");
    }
    if (globalActiveLease?.kind === "turn" && globalActiveLease.expiresAtNs <= monotonicNow()) {
      globalActiveLease.expire();
    }
    if (globalActiveLease !== null) {
      throw new LocalVmLeaseError("lease_contended", "The Local VM is already leased by another turn");
    }

    const handle = Object.freeze({ kind: "application-local-vm-turn-lease" as const });
    const controller = new AbortController();
    const state: TurnLeaseState = {
      kind: "turn",
      owner: this,
      binding: normalizedBinding,
      handle,
      controller,
      expiresAtNs: monotonicNow() + BigInt(Math.ceil(this.ttlMs * 1_000_000)),
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      active: true,
      expired: false,
      spawnClaimed: false,
      expire: () => {},
    };
    state.expire = () => {
      if (!state.active || state.expired) return;
      state.expired = true;
      if (!state.controller.signal.aborted) {
        state.controller.abort(new LocalVmLeaseError("lease_expired", "Local VM turn lease expired"));
      }
    };
    state.timer = setTimeout(state.expire, this.ttlMs);
    state.timer.unref?.();
    turnLeaseStates.set(handle, state);
    globalActiveLease = state;
    return handle;
  }

  releaseTurn(handle: LocalVmTurnLeaseHandle, binding: LocalVmTurnBinding): boolean {
    let normalizedBinding: LocalVmTurnBinding;
    try {
      normalizedBinding = normalizeBinding(binding);
    } catch {
      return false;
    }
    const state = turnLeaseStates.get(handle);
    if (!state || state.owner !== this || !state.active || globalActiveLease !== state || !exactBinding(state.binding, normalizedBinding)) {
      return false;
    }
    clearTurnState(state, "Local VM turn lease was released", "lease_unavailable");
    return true;
  }

  turnLifecycleResources(): { active: number; listeners: number; timers: number } {
    const state = globalActiveLease?.kind === "turn" && globalActiveLease.owner === this ? globalActiveLease : null;
    return {
      active: state?.active ? 1 : 0,
      listeners: 0,
      timers: state?.active && !state.expired ? 1 : 0,
    };
  }
}

function activeTurnState(handle: LocalVmTurnLeaseHandle, binding: LocalVmTurnBinding): TurnLeaseState {
  const normalizedBinding = normalizeBinding(binding);
  const state = turnLeaseStates.get(handle);
  if (!state || !state.active) {
    throw new LocalVmLeaseError("lease_unavailable", "Local VM turn lease is unavailable");
  }
  if (state.expired || state.expiresAtNs <= monotonicNow()) {
    state.expire();
    throw new LocalVmLeaseError("lease_expired", "Local VM turn lease expired");
  }
  if (!exactBinding(state.binding, normalizedBinding)) {
    throw new LocalVmLeaseError("lease_mismatch", "Local VM turn lease binding does not match");
  }
  return state;
}

/** Internal server boundary used immediately before child creation. */
export function claimLocalVmTurnSpawn(
  handle: LocalVmTurnLeaseHandle,
  binding: LocalVmTurnBinding,
): AbortSignal {
  const state = activeTurnState(handle, binding);
  if (state.spawnClaimed) {
    throw new LocalVmLeaseError("lease_reused", "Local VM turn lease cannot spawn more than once");
  }
  state.spawnClaimed = true;
  return state.controller.signal;
}

/** Internal server boundary used immediately before every tools/call. */
export function assertLocalVmTurnExecution(
  handle: LocalVmTurnLeaseHandle,
  binding: LocalVmTurnBinding,
): void {
  const state = activeTurnState(handle, binding);
  if (!state.spawnClaimed) {
    throw new LocalVmLeaseError("lease_unavailable", "Local VM turn lease has not claimed its child process");
  }
}

/** Lets the application coordinator propagate lease expiry into provider,
 * approval, and MCP cancellation without exposing ownership mutation. */
export function localVmTurnLeaseSignal(
  handle: LocalVmTurnLeaseHandle,
  binding: LocalVmTurnBinding,
): AbortSignal {
  return activeTurnState(handle, binding).controller.signal;
}

/** Returns the immutable binding captured at acquisition so later caller
 * mutation cannot create a spawn/approval/release TOCTOU gap. */
export function localVmTurnLeaseBinding(handle: LocalVmTurnLeaseHandle): LocalVmTurnBinding {
  const state = turnLeaseStates.get(handle);
  if (!state || !state.active) {
    throw new LocalVmLeaseError("lease_unavailable", "Local VM turn lease is unavailable");
  }
  return state.binding;
}

/** Cleanup uses the capability's recorded owner rather than a caller-supplied
 * manager, preventing owner substitution from leaking a stale fence. */
export function releaseLocalVmTurnLease(
  handle: LocalVmTurnLeaseHandle,
  binding: LocalVmTurnBinding,
): boolean {
  const state = turnLeaseStates.get(handle);
  if (!state || !state.active || globalActiveLease !== state) return false;
  let normalizedBinding: LocalVmTurnBinding;
  try {
    normalizedBinding = normalizeBinding(binding);
  } catch {
    return false;
  }
  if (!exactBinding(state.binding, normalizedBinding)) return false;
  clearTurnState(state, "Local VM turn lease was released", "lease_unavailable");
  return true;
}
