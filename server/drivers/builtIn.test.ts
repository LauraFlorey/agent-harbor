// The central harness routes from declared behavior, never a provider name.
// Pin every built-in here so adding or changing an engine cannot silently
// grant it host execution, computer control, or the wrong history strategy.
import { describe, expect, it } from "vitest";

import type { ProviderAdapter } from "../contracts.ts";
import { BUILT_IN_DRIVERS } from "./builtIn.ts";

type RoutingCapabilities = Pick<
  ProviderAdapter["capabilities"],
  "contextMode" | "executionMode" | "computerUse"
>;

const RESUME_LOCAL_NONE: RoutingCapabilities = {
  contextMode: "resume-cursor",
  executionMode: "local-process",
  computerUse: "none",
};

const RESUME_LOCAL_MCP: RoutingCapabilities = {
  contextMode: "resume-cursor",
  executionMode: "local-process",
  computerUse: "mcp",
};

const EXPECTED: Record<string, RoutingCapabilities> = {
  grok: {
    contextMode: "transcript-replay",
    executionMode: "local-process",
    computerUse: "none",
  },
  grokAgent: RESUME_LOCAL_MCP,
  geminiAgent: RESUME_LOCAL_MCP,
  kimiAgent: RESUME_LOCAL_MCP,
  droidAgent: RESUME_LOCAL_MCP,
  opencodeGo: RESUME_LOCAL_MCP,
  openrouter: {
    contextMode: "transcript-replay",
    executionMode: "local-process",
    computerUse: "none",
  },
  claudeAgent: RESUME_LOCAL_MCP,
  codex: RESUME_LOCAL_MCP,
  antigravityAgent: RESUME_LOCAL_NONE,
  boxAgent: {
    contextMode: "provider-managed",
    executionMode: "remote-computer",
    computerUse: "native",
  },
};

describe("built-in provider capabilities", () => {
  it("declares the provider-neutral routing contract for every built-in", async () => {
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );

    for (const driver of BUILT_IN_DRIVERS) {
      const instance = await driver.create({
        instanceId: `test-${driver.driverKind}`,
        displayName: driver.metadata.displayName,
        environment: {},
        enabled: true,
        config: driver.defaultConfig(),
      });
      try {
        expect(instance.adapter.capabilities).toMatchObject(EXPECTED[driver.driverKind]);
      } finally {
        await instance.dispose();
      }
    }
  });
});
