/**
 * Build the environment for an agent CLI or an agent-facing helper.
 *
 * Start from a small operating-system allowlist instead of process.env. Any
 * provider credential or product-specific setting must arrive through an
 * explicit override at the call site, so an unrelated secret exported in the
 * desktop/server environment cannot silently become visible to an agent.
 */

const PARENT_KEYS = new Set([
  // Executable and user-home discovery.
  "PATH",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "SHELL",
  "USER",
  "USERNAME",
  "LOGNAME",

  // Temporary and platform data directories.
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",

  // Windows process startup requirements.
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",

  // Locale and terminal behavior. Locale variants are handled below.
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "TZ",
  "__CF_USER_TEXT_ENCODING",

  // Certificate paths are configuration, not bearer credentials.
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
]);

export interface AgentEnvironmentOptions {
  /** Parent process environment. Injectable for deterministic tests. */
  parent?: NodeJS.ProcessEnv;
  /** Deliberate per-provider/per-helper values. `undefined` removes a key. */
  overrides?: Record<string, string | undefined>;
  /** Injectable for Windows case-insensitivity tests. */
  platform?: NodeJS.Platform;
}

function setValue(
  target: NodeJS.ProcessEnv,
  key: string,
  value: string | undefined,
  platform: NodeJS.Platform,
): void {
  if (platform === "win32") {
    const lower = key.toLowerCase();
    for (const existing of Object.keys(target)) {
      if (existing.toLowerCase() === lower) delete target[existing];
    }
  }
  if (value !== undefined) target[key] = value;
}

function allowedParentKey(key: string, testing: boolean): boolean {
  const upper = key.toUpperCase();
  if (PARENT_KEYS.has(upper) || upper.startsWith("LC_")) return true;
  // Scripted provider fixtures are subprocesses too. Preserve only their
  // synthetic controls while Vitest is active; production never gets this.
  return testing && /^FAKE_(?:ACP|AGY|CLAUDE|CODEX)_/.test(upper);
}

export function buildAgentEnvironment(options: AgentEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const parent = options.parent ?? process.env;
  const platform = options.platform ?? process.platform;
  const result: NodeJS.ProcessEnv = {};
  const testing = Boolean(parent.VITEST);

  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && allowedParentKey(key, testing)) setValue(result, key, value, platform);
  }
  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    setValue(result, key, value, platform);
  }
  return result;
}
