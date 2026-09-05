import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const help = `Agent Harbor development launcher

Usage:
  pnpm dev:all

Starts the harness server, Vite interface, and Electron desktop app in order.
Closing the desktop window or pressing Control-C stops all three processes.

Optional environment variables:
  OMB_PORT               harness server port (default: 8799)
  OMB_WEBHOOK_PORT       webhook receiver port (default: OMB_PORT + 1)
  AGENT_HARBOR_DEV_PORT  Vite interface port (default: 5199)
  AGENT_HARBOR_DEV_PROFILE  isolated Electron profile directory (optional)
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

function readPort(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

let serverPort;
let webhookPort;
let interfacePort;
let ports;
try {
  serverPort = readPort("OMB_PORT", 8799);
  webhookPort = readPort("OMB_WEBHOOK_PORT", serverPort + 1);
  interfacePort = readPort("AGENT_HARBOR_DEV_PORT", 5199);
  ports = [
    { port: serverPort, label: "harness server", override: "OMB_PORT" },
    { port: webhookPort, label: "webhook receiver", override: "OMB_WEBHOOK_PORT" },
    { port: interfacePort, label: "interface", override: "AGENT_HARBOR_DEV_PORT" },
  ];
  if (new Set(ports.map(({ port }) => port)).size !== ports.length) {
    throw new Error("The server, webhook, and interface ports must be different");
  }
} catch (error) {
  console.error(`[dev:all] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(350, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function assertPortsAreFree() {
  for (const { port, label, override } of ports) {
    if (await portIsOpen(port)) {
      throw new Error(
        `${label} port ${port} is already in use. Stop the existing process or set ${override} to another port.`,
      );
    }
  }
}

function startProcess(label, command, args, { cleanExitStopsAll = false, env = process.env } = {}) {
  console.log(`[dev:all] Starting ${label}…`);
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  children.push({ label, child });
  child.once("error", (error) => {
    if (!shuttingDown) {
      console.error(`[dev:all] Could not start ${label}: ${error.message}`);
      void shutdown(1);
    }
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    if (!cleanExitStopsAll || code !== 0) {
      console.error(`[dev:all] ${label} stopped unexpectedly (${detail}).`);
    } else {
      console.log(`[dev:all] ${label} closed.`);
    }
    void shutdown(cleanExitStopsAll && code === 0 ? 0 : 1);
  });
  return child;
}

async function waitForHttp(url, label, child, validate = () => true) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} exited before it became ready`);
    }
    try {
      const response = await fetch(url);
      if (response.ok && (await validate(response))) return;
    } catch {
      // The process is still starting.
    }
    await delay(175);
  }
  throw new Error(`${label} did not become ready within 30 seconds`);
}

async function stopProcess({ child }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (children.length > 0) console.log("\n[dev:all] Stopping Agent Harbor…");
  await Promise.allSettled([...children].reverse().map(stopProcess));
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

async function main() {
  await assertPortsAreFree();

  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    throw new Error("Electron is not installed. Run pnpm install, then try pnpm dev:all again.");
  }
  const vitePath = path.join(root, "node_modules", "vite", "bin", "vite.js");

  const server = startProcess(
    "harness server",
    process.execPath,
    ["--experimental-strip-types", path.join(root, "server", "index.ts")],
    {
      env: {
        ...process.env,
        OMB_PORT: String(serverPort),
        OMB_UI_ORIGIN: `http://127.0.0.1:${interfacePort}`,
        OMB_WEBHOOK_PORT: String(webhookPort),
      },
    },
  );
  await waitForHttp(
    `http://127.0.0.1:${serverPort}/api/health`,
    "Harness server",
    server,
    async (response) => (await response.json().catch(() => null))?.app === "openmausbot",
  );

  const vite = startProcess("interface", process.execPath, [
    vitePath,
    "--host",
    "127.0.0.1",
    "--port",
    String(interfacePort),
    "--strictPort",
  ], { env: { ...process.env, OMB_PORT: String(serverPort) } });
  await waitForHttp(
    `http://127.0.0.1:${interfacePort}/`,
    "Interface",
    vite,
    async (response) => (await response.text()).includes("Agent Harbor"),
  );

  const electronArgs = process.env.AGENT_HARBOR_DEV_PROFILE
    ? [`--user-data-dir=${path.resolve(process.env.AGENT_HARBOR_DEV_PROFILE)}`, root]
    : [root];
  startProcess("desktop app", electronPath, electronArgs, {
    cleanExitStopsAll: true,
    env: {
      ...process.env,
      OMB_PORT: String(serverPort),
      ELECTRON_START_URL: `http://127.0.0.1:${interfacePort}`,
    },
  });

  console.log(`
[dev:all] Agent Harbor is ready.
[dev:all] Server:    http://127.0.0.1:${serverPort}
[dev:all] Interface: http://127.0.0.1:${interfacePort}
[dev:all] Press Control-C here to stop everything.`);
}

main().catch((error) => {
  console.error(`[dev:all] ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
