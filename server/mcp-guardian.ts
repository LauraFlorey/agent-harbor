// Cross-platform process-tree anchor for one turn-scoped MCP server. The
// anchor stays alive when the MCP leader fails, so Windows taskkill /T still
// has a live root from which to reap helpers. POSIX uses the same process
// group and gets the same ownership semantics.
import { spawn } from "node:child_process";

const command = process.env.AGENT_HARBOR_MCP_COMMAND;
const encodedArgs = process.env.AGENT_HARBOR_MCP_ARGS;
if (!command || !encodedArgs) process.exit(2);

let args: string[];
try {
  const parsed = JSON.parse(encodedArgs) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) process.exit(2);
  args = parsed;
} catch {
  process.exit(2);
}

const childEnv = { ...process.env };
delete childEnv.AGENT_HARBOR_MCP_COMMAND;
delete childEnv.AGENT_HARBOR_MCP_ARGS;

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let stopping = false;
let reported = false;
let anchor: ReturnType<typeof setInterval> | undefined;

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.resume();

function stop(): void {
  if (stopping) return;
  stopping = true;
  // Stay alive until the owner finishes process-tree cleanup. Keeping the
  // group leader present closes the grace-period PID/PGID reuse window and
  // gives Windows taskkill /T a stable root even if the MCP child is gone.
  anchor ??= setInterval(() => {}, 1_000);
  try {
    child.stdin.end();
    child.kill("SIGTERM");
  } catch {
    /* child already exited */
  }
}

process.stdin.on("end", stop);
process.stdin.on("error", stop);
process.stdout.on("error", stop);
process.on("SIGTERM", () => {
  stop();
});

function reportUnexpectedExit(): void {
  if (stopping || reported) return;
  reported = true;
  // Deliberately invalid JSON makes the owning client fail closed without
  // relaying child stderr, exit details, arguments, or environment values.
  process.stdout.write("{agent-harbor-mcp-child-exited}\n");
  anchor ??= setInterval(() => {}, 1_000);
}

child.on("error", reportUnexpectedExit);
child.on("exit", reportUnexpectedExit);
child.stdin.on("error", reportUnexpectedExit);
child.stdout.on("error", reportUnexpectedExit);
child.stderr.on("error", reportUnexpectedExit);
