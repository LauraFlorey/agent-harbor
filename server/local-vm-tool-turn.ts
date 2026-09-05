import type { ProviderToolDefinition } from "./contracts.ts";
import {
  LocalVmLease,
  LocalVmLeaseError,
  localVmTurnLeaseBinding,
  localVmTurnLeaseSignal,
  releaseLocalVmTurnLease,
  renewLocalVmTurnLease,
  type LocalVmTurnBinding,
  type LocalVmTurnLeaseHandle,
} from "./local-vm-lease.ts";
import type { LocalVmMcpEndpoint } from "./local-vm-mcp.ts";
import { TurnMcpError, TurnScopedMcpClient } from "./mcp-client.ts";
import type {
  ApplicationToolApprovalChannel,
  ApprovedToolRequests,
} from "./tool-approval.ts";
import {
  createToolTurnControl,
  type LocalVmToolTurnLimits,
  type ToolTurnControlOwner,
  type TurnObservationEvent,
} from "./tool-turn-control.ts";

export interface LocalVmToolTurnOptions {
  readonly lease: LocalVmLease;
  readonly binding: LocalVmTurnBinding;
  /** Resolved only after the exclusive turn lease is held, preventing Local
   * VM lifecycle operations from racing endpoint inspection and child spawn. */
  readonly endpoint: LocalVmMcpEndpoint | ((signal: AbortSignal) => Promise<LocalVmMcpEndpoint>);
  readonly approval?: ApplicationToolApprovalChannel;
  readonly limits?: Partial<LocalVmToolTurnLimits>;
  readonly signal?: AbortSignal;
  readonly observe?: (event: TurnObservationEvent) => void;
}

export interface LocalVmToolTurnContext {
  readonly tools: readonly ProviderToolDefinition[];
  readonly requests: ApprovedToolRequests;
  readonly signal: AbortSignal;
  lifecycleResources(): {
    approval: ReturnType<ApprovedToolRequests["lifecycleResources"]>;
    mcp: ReturnType<TurnScopedMcpClient["lifecycleResources"]>;
    turn: ReturnType<ToolTurnControlOwner["lifecycleResources"]>;
    lease: ReturnType<LocalVmLease["turnLifecycleResources"]>;
  };
}

function abortResult(owner: ToolTurnControlOwner): Error {
  return owner.failure() ?? new Error("Local VM tool turn was cancelled");
}

function raceAbort<T>(owner: ToolTurnControlOwner, operation: Promise<T>): Promise<T> {
  if (owner.signal.aborted) return Promise.reject(abortResult(owner));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortResult(owner));
    owner.signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, aborted]).finally(() => {
    if (onAbort) owner.signal.removeEventListener("abort", onAbort);
  });
}

function leaseEvent(error: unknown): "contended" | "expired" | "mismatch" | "reused" | null {
  if (!(error instanceof LocalVmLeaseError)) return null;
  if (error.code === "lease_contended") return "contended";
  if (error.code === "lease_expired") return "expired";
  if (error.code === "lease_mismatch") return "mismatch";
  if (error.code === "lease_reused") return "reused";
  return null;
}

function primaryTurnFailure(owner: ToolTurnControlOwner, error: unknown): unknown {
  const controlled = owner.failure();
  if (
    error instanceof TurnMcpError &&
    error.code !== "aborted" &&
    controlled?.code === "aborted" &&
    controlled.message === "Local VM lease ended before the turn completed"
  ) {
    return error;
  }
  return controlled ?? error;
}

/** Dormant Story 5 orchestration boundary. It owns one lease, one MCP child,
 * one approval session, and one provider operation for exactly one turn. */
export async function runLocalVmToolTurn<T>(
  options: LocalVmToolTurnOptions,
  providerTurn: (context: LocalVmToolTurnContext) => Promise<T>,
): Promise<T> {
  let handle: LocalVmTurnLeaseHandle | null = null;
  let leasedBinding: LocalVmTurnBinding | null = null;
  const owner = createToolTurnControl({
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    observe: (event) => {
      // Renew the turn lease on genuine progress so an actively working turn
      // is not aborted mid-action; a turn that stops emitting still expires.
      if (handle && leasedBinding) renewLocalVmTurnLease(handle, leasedBinding);
      options.observe?.(event);
    },
  });
  let client: TurnScopedMcpClient | null = null;
  let requests: ApprovedToolRequests | null = null;
  let leaseAbort: (() => void) | null = null;
  let leaseExpired = false;
  let result: T | undefined;
  let failure: unknown;
  let completed = false;

  try {
    owner.emit({ type: "state.transition", state: "acquiring" });
    if (owner.signal.aborted) throw abortResult(owner);
    try {
      handle = options.lease.acquireTurn(options.binding, owner.signal);
      leasedBinding = localVmTurnLeaseBinding(handle);
    } catch (error) {
      const lifecycle = leaseEvent(error);
      if (lifecycle) owner.emit({ type: "lease.lifecycle", lease: lifecycle });
      throw error;
    }
    owner.emit({ type: "lease.lifecycle", lease: "acquired" });

    const leaseSignal = localVmTurnLeaseSignal(handle, leasedBinding);
    leaseAbort = () => {
      const reason = leaseSignal.reason;
      if (reason instanceof LocalVmLeaseError && reason.code === "lease_expired") {
        leaseExpired = true;
      }
      owner.cancel("aborted", "Local VM lease ended before the turn completed");
      if (leaseExpired) {
        try {
          owner.emit({ type: "lease.lifecycle", lease: "expired" });
        } catch {
          // The cancellation cause and cleanup fence must survive observer failure.
        }
      }
    };
    leaseSignal.addEventListener("abort", leaseAbort, { once: true });

    const endpoint = typeof options.endpoint === "function"
      ? await raceAbort(owner, options.endpoint(owner.signal))
      : options.endpoint;
    client = await TurnScopedMcpClient.connect(endpoint, {
      signal: owner.signal,
      timeoutMs: owner.limits.mcpRequestTimeoutMs,
      turnControl: owner.control,
      turnLease: Object.freeze({
        handle,
        binding: leasedBinding,
      }),
    });
    requests = client.createToolApprovalSession({
      turnId: leasedBinding.turnId,
      approvalTimeoutMs: owner.limits.approvalWaitTimeoutMs,
      ...(options.approval ? { approval: options.approval } : {}),
    });
    owner.emit({ type: "state.transition", state: "active" });
    const context: LocalVmToolTurnContext = Object.freeze({
      tools: client.tools,
      requests,
      signal: owner.signal,
      lifecycleResources: () => ({
        approval: requests!.lifecycleResources(),
        mcp: client!.lifecycleResources(),
        turn: owner.lifecycleResources(),
        lease: options.lease.turnLifecycleResources(),
      }),
    });
    result = await client.runUntilSettled(() => raceAbort(owner, Promise.resolve().then(() => providerTurn(context))));
    completed = true;
  } catch (error) {
    failure = primaryTurnFailure(owner, error);
  } finally {
    try {
      owner.emit({ type: "state.transition", state: owner.signal.aborted ? "cancelling" : "cleaning" });
    } catch (error) {
      failure ??= error;
    }
    if (handle && leasedBinding && leaseAbort) {
      try {
        localVmTurnLeaseSignal(handle, leasedBinding).removeEventListener("abort", leaseAbort);
      } catch {
        // Startup failure may already have consumed and released the lease.
      }
    }
    try {
      requests?.close();
    } catch (error) {
      failure ??= error;
    }
    try {
      await client?.finish();
    } catch (error) {
      failure ??= error;
      try {
        owner.emit({ type: "cleanup.outcome", outcome: "failure" });
      } catch (observeError) {
        failure ??= observeError;
      }
    }
    if (handle && leasedBinding) {
      try {
        releaseLocalVmTurnLease(handle, leasedBinding);
      } catch (error) {
        failure ??= error;
      }
      try {
        owner.emit({ type: "lease.lifecycle", lease: leaseExpired ? "expired" : "released" });
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      owner.emit({ type: "cleanup.outcome", outcome: failure ? "failure" : "success" });
      owner.emit({ type: "state.transition", state: "closed" });
    } catch (error) {
      failure ??= error;
    }
    failure ??= owner.failure();
    try {
      owner.dispose();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) throw failure;
  if (!completed) throw new Error("Local VM tool turn did not complete");
  return result as T;
}
