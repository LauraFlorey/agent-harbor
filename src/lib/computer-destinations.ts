import type { ComputerUseMode } from "../../server/contracts.ts";

export type ComputerDestination = "cloud" | "vm" | "local" | "off";

export interface ComputerRoutingCapabilities {
  computerUse?: ComputerUseMode;
  executionMode?: "local-process" | "remote-computer";
}

export interface ComputerRoutingContext {
  /** Exact-model, agent, and feature authority for a server-owned Local VM
   * turn. It never grants host or cloud computer access. */
  localVmServerEligible?: boolean;
}

export function supportsComputerDestination(
  capabilities: ComputerRoutingCapabilities | undefined,
  destination: ComputerDestination,
  context: ComputerRoutingContext = {},
): boolean {
  if (destination === "off") return true;
  if (destination === "vm") {
    if (context.localVmServerEligible) return true;
    return (
      capabilities?.executionMode === "local-process" &&
      (capabilities.computerUse === "mcp" || capabilities.computerUse === "server")
    );
  }
  if (destination === "local") return capabilities?.computerUse === "mcp";
  return capabilities?.computerUse === "mcp" || capabilities?.computerUse === "native";
}

export function computerDestinationLabel(destination: ComputerDestination): string {
  if (destination === "cloud") return "the Cloud box";
  if (destination === "vm") return "the Local VM";
  if (destination === "local") return "this computer";
  return "computer access";
}
