// Resolve the server dependency boundary from outside the checkout, without its dependencies.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "ah-server-package-"));
try {
  cpSync(join(root, "dist-server"), join(directory, "server"), { recursive: true });
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `await import('./server/tool-approval.js'); console.log('Isolated packaged approval module loaded');`], {
    cwd: directory, env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, encoding: "utf8",
  });
  if (probe.status !== 0) throw new Error(probe.stderr || "Packaged server dependencies are incomplete");
  console.log(probe.stdout.trim());
} finally { rmSync(directory, { recursive: true, force: true }); }
