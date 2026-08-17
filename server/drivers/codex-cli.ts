import { homedir } from "node:os";
import { join } from "node:path";

import { execCli } from "../procs.ts";

export type CodexCliProbe =
  | { state: "compatible"; version: string | null }
  | { state: "incompatible" }
  | { state: "missing" };

export type CodexCliResolution =
  | { ok: true; command: string; version: string | null }
  | { ok: false; reason: string; setup: true };

export interface CodexCliResolutionOptions {
  platform?: NodeJS.Platform;
  home?: string;
  probe?: (command: string, env: NodeJS.ProcessEnv) => Promise<CodexCliProbe>;
}

function exec(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; stdout: string; missing: boolean }> {
  return new Promise((resolve) => {
    execCli(command, args, { timeout: 8000, env }, (error, stdout) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      resolve({ ok: !error, stdout: stdout.trim(), missing: code === "ENOENT" });
    });
  });
}

/** A usable Agent Harbor Codex CLI must advertise the JSON-RPC app server.
 *
 * `--version` alone is insufficient: early Codex releases accept that flag
 * but do not implement subcommands. Inspecting top-level help is intentionally
 * passive; calling `app-server --help` could be misread as a prompt by one of
 * those old releases.
 */
export async function probeCodexCli(command: string, env: NodeJS.ProcessEnv): Promise<CodexCliProbe> {
  const help = await exec(command, ["--help"], env);
  if (!help.ok) return { state: help.missing ? "missing" : "incompatible" };
  if (!/(^|\s)app-server(?:\s|$)/m.test(help.stdout)) return { state: "incompatible" };

  const version = await exec(command, ["--version"], env);
  return { state: "compatible", version: version.ok ? version.stdout || null : null };
}

/** Candidate order is deliberate: preserve normal PATH behavior first, then
 * try official macOS app bundles that can carry a newer CLI than Homebrew.
 * An explicit custom command is never replaced with a fallback.
 */
export function codexCliCandidates(
  configuredCli: string,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  if (configuredCli !== "codex" || platform !== "darwin") return [configuredCli];

  return [
    configuredCli,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    join(home, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
    join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
  ];
}

export async function resolveCompatibleCodexCli(
  configuredCli: string,
  env: NodeJS.ProcessEnv,
  options: CodexCliResolutionOptions = {},
): Promise<CodexCliResolution> {
  const probe = options.probe ?? probeCodexCli;
  const candidates = codexCliCandidates(configuredCli, options.platform, options.home);
  let foundIncompatible = false;

  for (const command of [...new Set(candidates)]) {
    const result = await probe(command, env);
    if (result.state === "compatible") return { ok: true, command, version: result.version };
    if (result.state === "incompatible") foundIncompatible = true;
  }

  if (foundIncompatible) {
    return {
      ok: false,
      reason: `\`${configuredCli}\` was found, but it does not support \`codex app-server\`; update Codex or configure a compatible CLI`,
      setup: true,
    };
  }
  return { ok: false, reason: `\`${configuredCli}\` CLI not found`, setup: true };
}
