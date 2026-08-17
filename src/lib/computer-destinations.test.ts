import { describe, expect, it } from "vitest";

import { computerDestinationLabel, supportsComputerDestination } from "./computer-destinations";

describe("computer destination compatibility", () => {
  const textOnly = { computerUse: "none", executionMode: "local-process" } as const;
  const localMcp = { computerUse: "mcp", executionMode: "local-process" } as const;
  const remoteNative = { computerUse: "native", executionMode: "remote-computer" } as const;

  it("always permits turning computer access off", () => {
    expect(supportsComputerDestination(undefined, "off")).toBe(true);
    expect(supportsComputerDestination(textOnly, "off")).toBe(true);
  });

  it("keeps text-only engines away from every computer destination", () => {
    expect(supportsComputerDestination(textOnly, "vm")).toBe(false);
    expect(supportsComputerDestination(textOnly, "local")).toBe(false);
    expect(supportsComputerDestination(textOnly, "cloud")).toBe(false);
  });

  it("allows a local MCP engine to use the Local VM, host, or cloud bridge", () => {
    expect(supportsComputerDestination(localMcp, "vm")).toBe(true);
    expect(supportsComputerDestination(localMcp, "local")).toBe(true);
    expect(supportsComputerDestination(localMcp, "cloud")).toBe(true);
  });

  it("limits a native remote-computer engine to the cloud destination", () => {
    expect(supportsComputerDestination(remoteNative, "cloud")).toBe(true);
    expect(supportsComputerDestination(remoteNative, "vm")).toBe(false);
    expect(supportsComputerDestination(remoteNative, "local")).toBe(false);
  });

  it("uses the same destination wording shown to the user", () => {
    expect(computerDestinationLabel("cloud")).toBe("the Cloud box");
    expect(computerDestinationLabel("vm")).toBe("the Local VM");
    expect(computerDestinationLabel("local")).toBe("this computer");
  });
});
