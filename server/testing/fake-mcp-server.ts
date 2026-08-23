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
  toolCallNames: [] as string[],
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
const pairedToolCalls: Array<{ id?: number; name: string }> = [];
process.stdin.on("data", (chunk) => {
  input += String(chunk);
  for (;;) {
    const newline = input.indexOf("\n");
    if (newline === -1) return;
    const line = input.slice(0, newline).trim();
    input = input.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line) as { id?: number; method?: string; params?: unknown };
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
      if (mode === "external-ref-schema" || mode === "regex-schema" || mode === "format-schema" || mode === "unsupported-schema") {
        const inputSchema = mode === "external-ref-schema"
          ? { $ref: "https://untrusted.invalid/schema.json" }
          : mode === "regex-schema"
            ? { type: "object", properties: { value: { type: "string", pattern: "^(a+)+$" } } }
            : mode === "format-schema"
              ? { type: "object", properties: { value: { type: "string", format: "custom-private-format" } } }
              : { type: "object", "x-unsupported-keyword": true };
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [{ name: "unsafe_schema", inputSchema }] },
        });
        continue;
      }
      if (mode === "too-many-tools") {
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: Array.from({ length: 129 }, (_, index) => ({
              name: `tool_${index}`,
              inputSchema: { type: "object", additionalProperties: false },
            })),
          },
        });
        continue;
      }
      if (mode === "too-deep-schema") {
        let inputSchema: Record<string, unknown> = { type: "string" };
        for (let depth = 0; depth < 70; depth += 1) inputSchema = { type: "array", items: inputSchema };
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [{ name: "deep_schema", inputSchema }] },
        });
        continue;
      }
      if (mode === "too-wide-schema" || mode === "oversized-schema") {
        const inputSchema = mode === "too-wide-schema"
          ? {
              type: "object",
              properties: Object.fromEntries(Array.from({ length: 5_000 }, (_, index) => [
                `field_${index}`,
                { type: "string" },
              ])),
            }
          : { type: "object", description: "x".repeat(270 * 1024) };
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [{ name: "resource_schema", inputSchema }] },
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
            ...(mode === "approval-tools" ? [
              {
                name: "submit_form",
                description: "Submit fields inside the isolated desktop",
                inputSchema: {
                  type: "object",
                  properties: {
                    password: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["password", "note"],
                  additionalProperties: false,
                },
              },
              {
                name: "structured_input",
                description: "Handle structured test data inside the isolated desktop",
                inputSchema: {
                  type: "object",
                  properties: {
                    payload: {
                      type: "object",
                      properties: {
                        tags: { type: "array", items: { type: "string" } },
                        enabled: { type: "boolean" },
                      },
                      required: ["tags", "enabled"],
                      additionalProperties: false,
                    },
                  },
                  required: ["payload"],
                  additionalProperties: false,
                },
              },
              {
                name: "json_shapes",
                description: "Handle bounded JSON shapes inside the isolated desktop",
                inputSchema: {
                  type: "object",
                  properties: { value: true },
                  required: ["value"],
                  additionalProperties: false,
                },
              },
              {
                name: "defaulted_input",
                description: "Prove schema defaults are not applied",
                inputSchema: {
                  type: "object",
                  properties: { mode: { type: "string", default: "safe" } },
                  required: ["mode"],
                  additionalProperties: false,
                },
              },
              {
                name: "recursive_node",
                description: "Validate a bounded recursive object",
                inputSchema: {
                  $defs: {
                    node: {
                      type: "object",
                      properties: {
                        value: { type: "string" },
                        child: { $ref: "#/$defs/node" },
                      },
                      required: ["value"],
                      additionalProperties: false,
                    },
                  },
                  $ref: "#/$defs/node",
                },
              },
            ] : []),
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
      continue;
    }
    if (request.method === "tools/call") {
      if (mode === "tool-rpc-error") {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32001, message: "private fixture detail" } });
        continue;
      }
      if (mode === "tool-hang") continue;
      const params = request.params && typeof request.params === "object"
        ? request.params as { name?: unknown; arguments?: unknown }
        : {};
      if (typeof params.name !== "string") {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "invalid params" } });
        continue;
      }
      state.toolCallNames.push(params.name);
      writeState();
      if (mode === "paired-tool-failure") {
        pairedToolCalls.push({ id: request.id, name: params.name });
        if (pairedToolCalls.length === 2) {
          const [failed, sibling] = pairedToolCalls;
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: failed?.id, error: { code: -32002, message: "paired private detail" } })}\n` +
            `${JSON.stringify({ jsonrpc: "2.0", id: sibling?.id, result: { content: [{ type: "text", text: `executed:${sibling?.name}` }], isError: false } })}\n`,
          );
        }
        continue;
      }
      if (mode === "oversized-tool-result") {
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: "x".repeat(2 * 1024 * 1024) }], isError: false },
        });
        continue;
      }
      const text = params.name === "click" && params.arguments && typeof params.arguments === "object"
        ? `clicked:${String((params.arguments as { x?: unknown }).x)},${String((params.arguments as { y?: unknown }).y)}`
        : `executed:${params.name}`;
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text }], isError: false },
      });
    }
  }
});

process.stdin.on("end", () => {
  cleanup();
  process.exit(0);
});
