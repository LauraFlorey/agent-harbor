// Config + data dirs. Non-secret settings live in ~/.openmausbot/config.json;
// credentials live in macOS Keychain (or a mode-0600 fallback off macOS).
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import type { InstanceConfigMap } from "./contracts.ts";
import { createPlatformSecretStore, type SecretId, type SecretStore } from "./secret-store.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  /** key = ck_… Connect consumer key (connections + agent tools);
   * apiKey = ak_… project API key — optional, unlocks the full toolkit
   * catalog with official logos in the plugins marketplace. */
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: { token?: string };
  /** Voice (ElevenLabs). `key` is the credential and is never echoed back;
   * `voice` is the chosen voice id, which is a setting, not a secret. */
  tts?: { key?: string; voice?: string };
  /** The person using the app (collected in onboarding, shown in the
   * sidebar). Not a secret — echoed back by GET /api/config. */
  profile?: { name?: string; email?: string };
  instances?: InstanceConfigMap;
}

// OMB_DATA_DIR isolates test/soak rigs from the user's real fleet.
export const DATA_DIR = process.env.OMB_DATA_DIR ?? join(homedir(), ".openmausbot");
const LEGACY_DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MANAGED_TOP_LEVEL = /^(config|secrets|bots|groups|routines)\.json$|^messages-[\w-]+\.json$/;

function secureManagedFile(path: string) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link for private OpenMausBot state: ${path}`);
  if (!stat.isFile()) throw new Error(`private OpenMausBot state is not a regular file: ${path}`);
  chmodSync(path, PRIVATE_FILE_MODE);
}

function secureExistingState() {
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (MANAGED_TOP_LEVEL.test(entry.name)) secureManagedFile(join(DATA_DIR, entry.name));
  }
  for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.endsWith(".ndjson")) secureManagedFile(join(dir, entry.name));
    }
  }
}

export function ensureDirs() {
  // one-time migration from the pre-rename data dir — bots, transcripts,
  // config and keys all carry over
  if (!existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
    try {
      renameSync(LEGACY_DATA_DIR, DATA_DIR);
    } catch {
      /* cross-device or busy — fall through to a fresh dir */
    }
  }
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) {
    mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
    chmodSync(dir, PRIVATE_DIR_MODE);
  }
  // This runs before the first config read, repairing older installations
  // whose files inherited a permissive process umask.
  secureExistingState();
}

type ConfigSection = "xai" | "composio" | "box" | "tts";
const SECRET_FIELDS: Array<{ section: ConfigSection; field: string; id: SecretId; env?: string }> = [
  { section: "xai", field: "key", id: "xai.key", env: "XAI_API_KEY" },
  { section: "composio", field: "key", id: "composio.key", env: "COMPOSIO_KEY" },
  { section: "composio", field: "apiKey", id: "composio.apiKey", env: "COMPOSIO_API_KEY" },
  { section: "box", field: "token", id: "box.token", env: "BOX_TOKEN" },
  { section: "tts", field: "key", id: "tts.key", env: "OMB_TTS_KEY" },
];

function objectSection(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Move legacy plaintext credentials only after the secure write succeeds.
 * A locked/unavailable keychain leaves the original value intact. */
function migrateLegacySecrets(disk: Record<string, unknown>, secrets: SecretStore): boolean {
  let changed = false;
  for (const descriptor of SECRET_FIELDS) {
    const section = objectSection(disk[descriptor.section]);
    if (!section || typeof section[descriptor.field] !== "string") continue;
    const value = String(section[descriptor.field]).trim();
    try {
      if (value) secrets.set(descriptor.id, value);
      else secrets.delete(descriptor.id);
      delete section[descriptor.field];
      changed = true;
    } catch (error) {
      console.warn(
        `config: could not migrate ${descriptor.id}; keeping the private legacy value: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return changed;
}

function storedSecret(secrets: SecretStore, descriptor: (typeof SECRET_FIELDS)[number]): string | undefined {
  try {
    return secrets.get(descriptor.id) ?? (descriptor.env ? process.env[descriptor.env] : undefined);
  } catch (error) {
    console.warn(`config: could not read ${descriptor.id}: ${error instanceof Error ? error.message : String(error)}`);
    return descriptor.env ? process.env[descriptor.env] : undefined;
  }
}

export function loadConfig(): AppConfig {
  ensureDirs();
  const path = join(DATA_DIR, "config.json");
  let disk: Record<string, unknown> = {};
  try {
    disk = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* first run — env fallbacks below */
  }
  const secrets = createPlatformSecretStore(DATA_DIR);
  if (migrateLegacySecrets(disk, secrets)) writeFileAtomic(path, JSON.stringify(disk, null, 2), PRIVATE_FILE_MODE);

  const cfg = disk as AppConfig;
  const values = new Map(SECRET_FIELDS.map((descriptor) => [descriptor.id, storedSecret(secrets, descriptor)]));
  cfg.xai = { ...cfg.xai, key: values.get("xai.key") };
  cfg.composio = {
    ...cfg.composio,
    key: values.get("composio.key"),
    apiKey: values.get("composio.apiKey"),
  };
  cfg.box = { ...cfg.box, token: values.get("box.token") };
  cfg.tts = { ...cfg.tts, key: values.get("tts.key") };
  return cfg;
}

/** Merge settings into config.json and credentials into the secure store.
 * Secrets are never echoed back; callers report configured booleans only. */
export function saveConfig(patch: Partial<AppConfig>): void {
  ensureDirs();
  const p = join(DATA_DIR, "config.json");
  let disk: Record<string, unknown> = {};
  try {
    disk = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* first write */
  }
  const secrets = createPlatformSecretStore(DATA_DIR);
  migrateLegacySecrets(disk, secrets);
  const sanitized = structuredClone(patch) as Record<string, unknown>;
  for (const descriptor of SECRET_FIELDS) {
    const section = objectSection(sanitized[descriptor.section]);
    if (!section || typeof section[descriptor.field] !== "string") continue;
    const value = String(section[descriptor.field]).trim();
    if (value) secrets.set(descriptor.id, value);
    else secrets.delete(descriptor.id);
    delete section[descriptor.field];
  }
  for (const key of ["xai", "composio", "box", "tts", "profile"] as const) {
    const section = objectSection(sanitized[key]);
    if (section && Object.keys(section).length) {
      disk[key] = { ...objectSection(disk[key]), ...section };
    }
  }
  writeFileAtomic(p, JSON.stringify(disk, null, 2), PRIVATE_FILE_MODE);
}

// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The default `grok` instance rides the `grokAgent` driver, not the API-key
  // one: like claude and codex it needs no credential from us, just the CLI
  // installed and logged in (it shows up unavailable otherwise). The API-key
  // `grok` driver stays registered but out of the default fleet — that key is
  // a credential Milind doesn't want to manage; an `instances` entry brings
  // it back anytime.
  //
  // Google rides `antigravityAgent` (the `agy` CLI), not `geminiAgent`:
  // Google retired Gemini CLI for the free/Pro/Ultra tiers on 2026-06-18
  // (developers.googleblog.com, "transitioning Gemini CLI to Antigravity
  // CLI"), so a default `gemini` instance could only ever show unavailable.
  // The driver stays registered for enterprise licences, which keep Gemini
  // CLI — `{"instances": {"gemini": {"driver": "geminiAgent"}}}` restores it.
  const map: InstanceConfigMap =
    cfg.instances && Object.keys(cfg.instances).length
      ? cfg.instances
      : {
          grok: { driver: "grokAgent" },
          kimi: { driver: "kimiAgent" },
          claude: { driver: "claudeAgent" },
          codex: { driver: "codex" },
          antigravity: { driver: "antigravityAgent" },
          computer: { driver: "boxAgent" },
        };
  for (const entry of Object.values(map)) {
    entry.environment = {
      ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
      ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
      ...entry.environment,
    };
  }
  return map;
}
