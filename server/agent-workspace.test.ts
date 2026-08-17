import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { AGENT_WORKSPACES_DIR, agentWorkingDirectory, agentWorkspace } from "./agent-workspace.ts";

describe("agent workspaces", () => {
  beforeEach(() => rmSync(AGENT_WORKSPACES_DIR, { recursive: true, force: true }));

  it("creates a stable private directory for each bot", () => {
    const first = agentWorkspace("bot-one");
    const second = agentWorkspace("bot-two");

    expect(first).toBe(join(AGENT_WORKSPACES_DIR, "bot-one"));
    expect(second).toBe(join(AGENT_WORKSPACES_DIR, "bot-two"));
    expect(first).not.toBe(second);
    expect(agentWorkspace("bot-one")).toBe(first);
    if (process.platform !== "win32") {
      expect(lstatSync(AGENT_WORKSPACES_DIR).mode & 0o777).toBe(0o700);
      expect(lstatSync(first).mode & 0o777).toBe(0o700);
    }
  });

  it("defaults to the private workspace and uses home only after explicit opt-in", () => {
    expect(agentWorkingDirectory({ id: "safe-bot" })).toBe(join(AGENT_WORKSPACES_DIR, "safe-bot"));
    expect(agentWorkingDirectory({ id: "safe-bot", hostAccess: false })).toBe(
      join(AGENT_WORKSPACES_DIR, "safe-bot"),
    );
    expect(agentWorkingDirectory({ id: "safe-bot", hostAccess: true })).toBe(homedir());
  });

  it("rejects traversal and an existing symlink", () => {
    expect(() => agentWorkspace("../outside")).toThrow("invalid bot id");
    if (process.platform === "win32") return;

    mkdirSync(AGENT_WORKSPACES_DIR, { recursive: true });
    symlinkSync(homedir(), join(AGENT_WORKSPACES_DIR, "linked"), "dir");
    expect(() => agentWorkspace("linked")).toThrow("refusing symbolic link");
  });
});
