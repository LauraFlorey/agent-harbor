// Per-agent working directories. Local provider CLIs start here instead of
// the user's home directory. This is one layer of the boundary: individual
// providers still enforce their own sandbox and approval policies.
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

const PRIVATE_DIR_MODE = 0o700;
const SAFE_BOT_ID = /^[A-Za-z0-9_-]+$/;

export const AGENT_WORKSPACES_DIR = join(DATA_DIR, "workspaces");

function secureDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link for agent workspace: ${path}`);
  if (!stat.isDirectory()) throw new Error(`agent workspace is not a directory: ${path}`);
  chmodSync(path, PRIVATE_DIR_MODE);
}

/** Create or reopen one stable, private workspace owned by a single bot. */
export function agentWorkspace(botId: string): string {
  if (!SAFE_BOT_ID.test(botId)) throw new Error("invalid bot id for agent workspace");
  mkdirSync(AGENT_WORKSPACES_DIR, { recursive: true, mode: PRIVATE_DIR_MODE });
  secureDirectory(AGENT_WORKSPACES_DIR);

  const path = join(AGENT_WORKSPACES_DIR, botId);
  if (!existsSync(path)) mkdirSync(path, { mode: PRIVATE_DIR_MODE });
  secureDirectory(path);
  return path;
}

/** Host access is an explicit per-bot choice; absence always fails closed. */
export function agentWorkingDirectory(bot: { id: string; hostAccess?: boolean }): string {
  return bot.hostAccess === true ? homedir() : agentWorkspace(bot.id);
}
