// Cross-platform process spawning for the agent CLIs. Three Windows
// differences are exposed to drivers through this module:
//   1. CreateProcess can't exec npm .cmd/.bat shims or node-shebang scripts
//      directly. env-path resolves those to their real .exe / `node script`
//      entry without a shell, so quoting-sensitive JSON argv stays intact.
//   2. No process-group kill (kill(-pid) is POSIX) — taskkill /T reaps the
//      whole tree, CLI + its spawned MCP proxies alike.
//   3. Console apps spawned from the GUI shell flash a console window
//      unless windowsHide is set.
import {
  spawn,
  spawnSync,
  execFile,
  type ChildProcess,
  type ChildProcessByStdio,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { join } from "node:path";
import { resolveCliSpawn, type ResolvedSpawn } from "./env-path.ts";

const TREE_KILL_GRACE_MS = 1_000;
const treeStops = new Set<Promise<void>>();
const stoppingTrees = new WeakSet<ChildProcess>();

function trackedTreeStop(child: ChildProcess, stop: () => Promise<void>): void {
  if (stoppingTrees.has(child)) return;
  stoppingTrees.add(child);
  let task: Promise<void>;
  task = stop().finally(() => treeStops.delete(task));
  treeStops.add(task);
}

/** Wait until every process tree already asked to stop has received its
 * forced fallback. Server shutdown calls this after disposing the fleet so
 * it cannot exit in the gap between SIGTERM and SIGKILL. */
export async function drainCliTrees(): Promise<void> {
  while (treeStops.size) await Promise.allSettled([...treeStops]);
}

function ownedProcessId(child: ChildProcess): number | null {
  const pid = child.pid;
  return Number.isSafeInteger(pid) && (pid as number) > 1 ? pid as number : null;
}

export function resolveCli(cli: string, args: string[] = []): ResolvedSpawn {
  return resolveCliSpawn(cli, args);
}

export function spawnCli(
  cli: string,
  args: string[],
  opts: SpawnOptions,
): ChildProcessByStdio<Writable, Readable, Readable> {
  const resolved = resolveCli(cli, args);
  return spawn(resolved.command, resolved.args, {
    ...opts,
    // posix: own process group so kill(-pid) reaps child MCP servers;
    // win32: taskkill /T does the reaping instead (see killCliTree)
    ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
  }) as ChildProcessByStdio<Writable, Readable, Readable>; // callers always pipe all three
}

export function execCli(
  cli: string,
  args: string[],
  opts: ExecFileOptions,
  cb: (err: Error | null, stdout: string) => void,
): void {
  const resolved = resolveCli(cli, args);
  execFile(resolved.command, resolved.args, { ...opts, windowsHide: true }, (err, stdout) =>
    cb(err, typeof stdout === "string" ? stdout : String(stdout)),
  );
}

/** Human wording for a failed CLI spawn.
 *
 * Node reports these as bare errno strings — "spawn grok ENOENT" — which
 * reads as a crash. On a CLI spawn the common codes mean exactly one thing
 * each, and both are setup problems the user can fix, so say which. The
 * `setup` flag lets the UI offer "Install" instead of a "Retry" that is
 * guaranteed to fail the same way. */
export function describeSpawnFailure(
  err: NodeJS.ErrnoException,
  cli: string,
): { message: string; setup: boolean } {
  if (err.code === "ENOENT")
    return { message: `\`${cli}\` isn't installed, or isn't on this app's PATH`, setup: true };
  if (err.code === "EACCES" || err.code === "EPERM")
    return { message: `\`${cli}\` isn't executable — check its file permissions`, setup: true };
  return { message: `spawn failed: ${err.message}`, setup: false };
}

/** Stop a CLI and every process it spawned (MCP proxies included). */
export function killCliTree(child: ChildProcess): void {
  const pid = ownedProcessId(child);
  if (pid === null) return;

  if (process.platform === "win32") {
    // taskkill identifies a tree by its live root PID. Refuse to address a
    // stale PID after Node has observed the owned root exit.
    if (child.exitCode !== null || child.signalCode !== null) return;
    trackedTreeStop(child, () => new Promise<void>((resolve) => {
      const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? process.env.WINDIR ?? "C:\\Windows";
      const taskkill = join(systemRoot, "System32", "taskkill.exe");
      execFile(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (err) => {
        if (err) {
          try {
            // taskkill is unavailable or the tree lookup failed. At least stop
            // the process we own instead of leaving the entire turn running.
            child.kill();
          } catch {
            /* already gone */
          }
        }
        resolve();
      });
    }));
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  trackedTreeStop(child, async () => {
    await new Promise((resolve) => setTimeout(resolve, TREE_KILL_GRACE_MS));
    try {
      // The group may outlive its leader (for example an MCP proxy whose CLI
      // already exited), so always address the process group, not `child`.
      process.kill(-pid, "SIGKILL");
    } catch {
      /* the whole group exited during the grace period */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** Last-chance process-exit fence. Unlike killCliTree, this cannot wait for a
 * grace period because Node's `exit` event does not run asynchronous work. */
export function killCliTreeNow(child: ChildProcess): void {
  const pid = ownedProcessId(child);
  if (pid === null) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? process.env.WINDIR ?? "C:\\Windows";
    const taskkill = join(systemRoot, "System32", "taskkill.exe");
    const result = spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (!result.error && result.status === 0) return;
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Per-turn broker channel: unix socket on POSIX, named pipe on Windows
 * (Node can't listen on a filesystem socket path there — EACCES). */
export function brokerSocketPath(dataDir: string, tag: string): string {
  return process.platform === "win32"
    // Named pipes share a global namespace; DATA_DIR cannot isolate two
    // concurrent app instances the way a POSIX socket directory does.
    ? `\\\\.\\pipe\\openmausbot-perm-${process.pid}-${tag}`
    : join(dataDir, `perm-${tag}.sock`);
}
