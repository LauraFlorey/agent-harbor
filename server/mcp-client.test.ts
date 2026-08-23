import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { StdioMcpEndpoint } from "./contracts.ts";
import { localVmMcpEndpoint, type LocalVmMcpEndpoint } from "./local-vm-mcp.ts";
import {
  TurnMcpError,
  TurnScopedMcpClient,
  withTurnScopedMcpClient,
} from "./mcp-client.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = join(SERVER_DIR, "testing", "fake-mcp-server.ts");
const scratch: string[] = [];

interface FakeState {
  parentPid: number;
  helperPid: number;
  argv: string[];
  cwd: string;
  secretInEnvironment: boolean;
  inheritedProviderSecret: boolean;
  runtimeOptionsInjected: boolean;
  methods: string[];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForState(dir: string): Promise<FakeState> {
  const path = join(dir, "state.json");
  const deadline = Date.now() + 5_000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return JSON.parse(await readFile(path, "utf8")) as FakeState;
}

async function assertReleased(dir: string): Promise<FakeState> {
  const state = await waitForState(dir);
  const deadline = Date.now() + 5_000;
  while ((alive(state.parentPid) || alive(state.helperPid)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(alive(state.parentPid)).toBe(false);
  expect(alive(state.helperPid)).toBe(false);
  expect(existsSync(join(dir, "turn-resource"))).toBe(false);
  return state;
}

async function fakeEndpoint(mode = "normal"): Promise<{ dir: string; endpoint: LocalVmMcpEndpoint }> {
  const dir = await mkdtemp(join(tmpdir(), "agent-harbor-mcp-"));
  scratch.push(dir);
  return {
    dir,
    endpoint: localVmMcpEndpoint({
      command: process.execPath,
      args: [FAKE_MCP],
      env: {
        FAKE_MCP_MODE: mode,
        FAKE_MCP_STATE_DIR: dir,
        MCP_TEST_SECRET: "turn-only-secret",
      },
    }),
  };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("turn-scoped Local VM MCP client", () => {
  it("discovers validated Cua-style tools and cleans success resources", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    const originalProviderSecret = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "must-not-be-inherited";
    let client: TurnScopedMcpClient | undefined;
    try {
      const names = await withTurnScopedMcpClient(endpoint, {}, async (turnClient) => {
        client = turnClient;
        expect(turnClient.lifecycleResources()).toEqual({ child: 1, listeners: 6, pending: 0, timers: 0 });
        expect(Object.isFrozen(turnClient.tools[1]?.inputSchema)).toBe(true);
        expect(Object.isFrozen(turnClient.tools[1]?.inputSchema.properties)).toBe(true);
        return turnClient.tools.map((tool) => tool.name);
      });
      expect(names).toEqual(["get_desktop_state", "click"]);
    } finally {
      if (originalProviderSecret === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalProviderSecret;
    }
    expect(client?.lifecycleResources()).toEqual({ child: 0, listeners: 0, pending: 0, timers: 0 });
    const state = await assertReleased(dir);
    expect(state.argv).toEqual([]);
    expect(state.cwd).toBe(SERVER_DIR);
    expect(state.secretInEnvironment).toBe(true);
    expect(state.inheritedProviderSecret).toBe(false);
    expect(state.runtimeOptionsInjected).toBe(false);
    expect(state.methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("cleans the process tree when the provider fails", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    let client: TurnScopedMcpClient | undefined;
    await expect(withTurnScopedMcpClient(endpoint, {}, async (turnClient) => {
      client = turnClient;
      throw new Error("provider failed");
    })).rejects.toThrow("provider failed");
    expect(client?.lifecycleResources()).toEqual({ child: 0, listeners: 0, pending: 0, timers: 0 });
    await assertReleased(dir);
  });

  it.each([
    ["rpc-error", "rpc_failure"],
    ["malformed", "invalid_response"],
    ["invalid-schema", "invalid_response"],
    ["invalid-nested-schema", "invalid_response"],
    ["invalid-tool-name", "invalid_response"],
  ])("cleans the process tree after %s MCP failure", async (mode, code) => {
    const { dir, endpoint } = await fakeEndpoint(mode);
    await expect(TurnScopedMcpClient.connect(endpoint)).rejects.toMatchObject({ code });
    await assertReleased(dir);
  });

  it("cleans the process tree and timer after initialization timeout", async () => {
    const { dir, endpoint } = await fakeEndpoint("hang");
    await expect(TurnScopedMcpClient.connect(endpoint, { timeoutMs: 500 })).rejects.toMatchObject({ code: "timeout" });
    await assertReleased(dir);
  });

  it("bounds stdout while continuously draining and discarding stderr", async () => {
    const noisy = await fakeEndpoint("noisy-stderr");
    await withTurnScopedMcpClient(noisy.endpoint, {}, async (client) => {
      expect(client.tools).toHaveLength(2);
    });
    await assertReleased(noisy.dir);

    const oversized = await fakeEndpoint("oversized-stdout");
    await expect(TurnScopedMcpClient.connect(oversized.endpoint)).rejects.toMatchObject({
      code: "invalid_response",
    });
    await assertReleased(oversized.dir);
  });

  it("decodes JSON-RPC when a UTF-8 code point is split across chunks", async () => {
    const { dir, endpoint } = await fakeEndpoint("split-utf8");
    await withTurnScopedMcpClient(endpoint, {}, async (client) => {
      expect(client.tools[0]?.description).toBe("Return the isolated 🖥️ state");
    });
    await assertReleased(dir);
  });

  it("cleans the process tree, listeners, and timers after abort", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    const controller = new AbortController();
    let client: TurnScopedMcpClient | undefined;
    await expect(withTurnScopedMcpClient(endpoint, { signal: controller.signal }, async (turnClient) => {
      client = turnClient;
      controller.abort();
      return new Promise<never>(() => {});
    })).rejects.toMatchObject({ code: "aborted" });
    expect(client?.lifecycleResources()).toEqual({ child: 0, listeners: 0, pending: 0, timers: 0 });
    await assertReleased(dir);
  });

  it("does not spawn when the turn is already cancelled", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    const controller = new AbortController();
    controller.abort();
    await expect(TurnScopedMcpClient.connect(endpoint, { signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });

  it("cleans up when abort races asynchronous endpoint validation", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    const controller = new AbortController();
    const connecting = TurnScopedMcpClient.connect(endpoint, { signal: controller.signal });
    controller.abort();
    await expect(connecting).rejects.toMatchObject({ code: "aborted" });
    if (existsSync(join(dir, "state.json"))) await assertReleased(dir);
  });

  it("cleans the process tree after an explicit turn interruption", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    let client: TurnScopedMcpClient | undefined;
    await expect(withTurnScopedMcpClient(endpoint, {}, async (turnClient) => {
      client = turnClient;
      await Promise.all([turnClient.close(), turnClient.close()]);
      return new Promise<never>(() => {});
    })).rejects.toMatchObject({ code: "closed" });
    expect(client?.lifecycleResources()).toEqual({ child: 0, listeners: 0, pending: 0, timers: 0 });
    await assertReleased(dir);
  });

  it("reaps the helper when the MCP leader exits first", async () => {
    const { dir, endpoint } = await fakeEndpoint("exit-after-list");
    await expect(withTurnScopedMcpClient(endpoint, {}, async () => new Promise<never>(() => {})))
      .rejects.toMatchObject({ code: "invalid_response" });
    await assertReleased(dir);
  });

  it("rejects unbranded, symlinked, and secret-bearing endpoints before spawn", async () => {
    const { dir, endpoint } = await fakeEndpoint();
    const unbranded: StdioMcpEndpoint = {
      command: endpoint.command,
      args: [...endpoint.args],
      env: { ...endpoint.env },
    };
    await expect(TurnScopedMcpClient.connect(unbranded as LocalVmMcpEndpoint)).rejects.toMatchObject({
      code: "invalid_endpoint",
    });
    expect(Object.isFrozen(endpoint)).toBe(true);
    expect(Object.isFrozen(endpoint.args)).toBe(true);
    expect(Object.isFrozen(endpoint.env)).toBe(true);
    expect(Reflect.ownKeys(endpoint)).toEqual(["command", "args", "env"]);

    const link = join(SERVER_DIR, "testing", `fake-mcp-link-${process.pid}.ts`);
    await symlink(FAKE_MCP, link);
    try {
      await expect(TurnScopedMcpClient.connect(localVmMcpEndpoint({
        command: process.execPath,
        args: [link],
        env: {},
      }))).rejects.toMatchObject({ code: "invalid_endpoint" });
    } finally {
      await rm(link, { force: true });
    }

    await expect(TurnScopedMcpClient.connect(localVmMcpEndpoint({
      command: process.execPath,
      args: [FAKE_MCP, "--api-key=turn-only-secret"],
      env: { MCP_TEST_SECRET: "turn-only-secret" },
    }))).rejects.toMatchObject({ code: "invalid_endpoint" });
    await expect(TurnScopedMcpClient.connect(localVmMcpEndpoint({
      command: process.execPath,
      args: [process.execPath],
      env: {},
    }))).rejects.toMatchObject({ code: "invalid_endpoint" });
    await expect(TurnScopedMcpClient.connect(localVmMcpEndpoint({
      command: process.execPath,
      args: [FAKE_MCP],
      env: { NODE_OPTIONS: `--require=${FAKE_MCP}` },
    }))).rejects.toMatchObject({ code: "invalid_endpoint" });
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });

  it("passes metacharacters, spaces, quotes, and backslashes as inert arguments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-harbor-mcp-"));
    const injectionDir = await mkdtemp(join(tmpdir(), "agent-harbor-injection-"));
    scratch.push(dir, injectionDir);
    const injected = join(injectionDir, "shell-was-invoked");
    const args = [`;touch ${injected}`, "space value", 'quote"value', "trailing\\"];
    const endpoint = localVmMcpEndpoint({
      command: process.execPath,
      args: [FAKE_MCP, ...args],
      env: { FAKE_MCP_STATE_DIR: dir },
    });
    await withTurnScopedMcpClient(endpoint, {}, async () => {});
    const state = await assertReleased(dir);
    expect(state.argv).toEqual(args);
    expect(existsSync(injected)).toBe(false);
  });

  it("cleans partial startup when the MCP child exits before initialization", async () => {
    const { dir, endpoint } = await fakeEndpoint("exit-before-initialize");
    await expect(TurnScopedMcpClient.connect(endpoint)).rejects.toMatchObject({ code: "invalid_response" });
    await assertReleased(dir);
  });

  it("uses stable, redacted failure messages", async () => {
    const { endpoint } = await fakeEndpoint("rpc-error");
    const error = await TurnScopedMcpClient.connect(endpoint).catch((caught) => caught);
    expect(error).toBeInstanceOf(TurnMcpError);
    expect(String(error)).not.toContain("fixture detail");
    expect(String(error)).not.toContain("turn-only-secret");
  });
});
