import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import { codexCliCandidates, resolveCompatibleCodexCli, type CodexCliProbe } from "./codex-cli.ts";

describe("codexCliCandidates", () => {
  it("keeps PATH first and includes official macOS app bundles", () => {
    expect(codexCliCandidates("codex", "darwin", "/Users/tester")).toEqual([
      "codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Users/tester/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Users/tester/Applications/Codex.app/Contents/Resources/codex",
    ]);
  });

  it("never adds fallbacks for an explicit custom command", () => {
    expect(codexCliCandidates("/opt/custom/codex", "darwin", homedir())).toEqual(["/opt/custom/codex"]);
  });
});

describe("resolveCompatibleCodexCli", () => {
  const resolver = (states: Record<string, CodexCliProbe>) => {
    const probe = vi.fn(async (command: string) => states[command] ?? { state: "missing" as const });
    return {
      probe,
      resolve: (configuredCli = "codex") =>
        resolveCompatibleCodexCli(configuredCli, {}, { platform: "darwin", home: "/Users/tester", probe }),
    };
  };

  it("skips an incompatible PATH binary and selects the bundled CLI", async () => {
    const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex";
    const { probe, resolve } = resolver({
      codex: { state: "incompatible" },
      [bundled]: { state: "compatible", version: "codex-cli 0.148.0" },
    });

    await expect(resolve()).resolves.toEqual({ ok: true, command: bundled, version: "codex-cli 0.148.0" });
    expect(probe.mock.calls.map(([command]) => command)).toEqual(["codex", bundled]);
  });

  it("does not replace an explicit incompatible command", async () => {
    const custom = "/opt/custom/codex";
    const { probe, resolve } = resolver({ [custom]: { state: "incompatible" } });

    await expect(resolve(custom)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("does not support") });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(custom, {});
  });

  it("distinguishes a missing CLI from an incompatible one", async () => {
    const { resolve } = resolver({});
    await expect(resolve()).resolves.toEqual({ ok: false, reason: "`codex` CLI not found", setup: true });
  });
});
