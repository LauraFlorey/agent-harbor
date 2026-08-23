// Dependency-free MCP stdio fixture for turn-lifecycle tests. It deliberately
// starts a helper process and a disposable marker so the parent test can prove
// the client reaps the whole tree and releases temporary resources.
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.env.FAKE_MCP_STATE_DIR;
if (!stateDir) process.exit(2);
const mode = process.env.FAKE_MCP_MODE ?? "normal";
const marker = join(stateDir, "turn-resource");
const statePath = join(stateDir, "state.json");
const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});

writeFileSync(marker, "owned by fake MCP turn\n", { mode: 0o600 });
const state = {
  parentPid: process.pid,
  helperPid: helper.pid,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  secretInEnvironment: process.env.MCP_TEST_SECRET === "turn-only-secret",
  inheritedProviderSecret: Boolean(process.env.OPENAI_API_KEY),
  runtimeOptionsInjected: Boolean(process.env.NODE_OPTIONS),
  methods: [] as string[],
};
const writeState = (): void => writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
writeState();

if (mode === "noisy-stderr") process.stderr.write("discarded\n".repeat(300_000));
if (mode === "oversized-stdout") process.stdout.write("x".repeat(2 * 1024 * 1024 + 1));

function cleanup(): void {
  if (existsSync(marker)) rmSync(marker, { force: true });
}

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

const send = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

let input = "";
process.stdin.on("data", (chunk) => {
  input += String(chunk);
  for (;;) {
    const newline = input.indexOf("\n");
    if (newline === -1) return;
    const line = input.slice(0, newline).trim();
    input = input.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line) as { id?: number; method?: string };
    if (request.method) {
      state.methods.push(request.method);
      writeState();
    }
    if (request.method === "initialize") {
      if (mode === "exit-before-initialize") process.exit(9);
      if (mode === "hang") continue;
      if (mode === "malformed") {
        process.stdout.write("{not-json}\n");
        continue;
      }
      if (mode === "rpc-error") {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "fixture detail" } });
        continue;
      }
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-cua", version: "1.0" },
        },
      });
      continue;
    }
    if (request.method === "tools/list") {
      if (mode === "invalid-tool-name") {
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [{ name: "click\ninjected", inputSchema: { type: "object" } }] },
        });
        continue;
      }
      if (mode === "invalid-schema") {
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [{ name: "click", inputSchema: { type: "not-a-json-schema-type" } }] },
        });
        continue;
      }
      if (mode === "invalid-nested-schema") {
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [{ name: "click", inputSchema: { type: "object", properties: { x: { type: "invalid" } } } }],
          },
        });
        continue;
      }
      const toolList = {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: [
            {
              name: "get_desktop_state",
              description: mode === "split-utf8" ? "Return the isolated 🖥️ state" : "Return the isolated desktop state",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
            {
              name: "click",
              description: "Click inside the isolated desktop",
              inputSchema: {
                type: "object",
                properties: {
                  x: { type: "integer" },
                  y: { type: "integer" },
                },
                required: ["x", "y"],
                additionalProperties: false,
              },
            },
          ],
        },
      };
      if (mode === "split-utf8") {
        const encoded = Buffer.from(`${JSON.stringify(toolList)}\n`);
        const emoji = encoded.indexOf(Buffer.from("🖥️"));
        process.stdout.write(encoded.subarray(0, emoji + 1));
        setImmediate(() => process.stdout.write(encoded.subarray(emoji + 1)));
      } else {
        send(toolList);
      }
      if (mode === "exit-after-list") setTimeout(() => process.exit(7), 10);
    }
  }
});

process.stdin.on("end", () => {
  cleanup();
  process.exit(0);
});
