import type { ComputerUseMode } from "../../server/contracts.ts";

export type ComputerDestination = "cloud" | "vm" | "local" | "off";

export interface ComputerRoutingCapabilities {
  computerUse?: ComputerUseMode;
  executionMode?: "local-process" | "remote-computer";
}

export function supportsComputerDestination(
  capabilities: ComputerRoutingCapabilities | undefined,
  destination: ComputerDestination,
): boolean {
  if (destination === "off") return true;
  if (destination === "vm") {
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
