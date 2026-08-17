import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export const SECRET_IDS = [
  "xai.key",
  "openrouter.apiKey",
  "composio.key",
  "composio.apiKey",
  "box.token",
  "opencodeGo.apiKey",
  "tts.key",
] as const;
export type SecretId = (typeof SECRET_IDS)[number];

export interface SecretStore {
  get(id: SecretId): string | undefined;
  set(id: SecretId, value: string): void;
  delete(id: SecretId): void;
}

export interface SecurityCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type SecurityCommandRunner = (args: string[], input?: string) => SecurityCommandResult;

const KEYCHAIN_SERVICE = "com.openmausbot.app.secrets";

const runSecurity: SecurityCommandRunner = (args, input) => {
  const result = spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
    timeout: 8_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
};

function commandError(action: string, result: SecurityCommandResult): Error {
  const detail = result.error?.message || result.stderr.trim() || `exit status ${String(result.status)}`;
  return new Error(`macOS Keychain ${action} failed: ${detail}`);
}

/** macOS login-keychain store. Secret values are supplied on stdin instead
 * of argv so they never appear in `ps` output. */
export function createKeychainSecretStore(
  runner: SecurityCommandRunner = runSecurity,
  service = KEYCHAIN_SERVICE,
): SecretStore {
  return {
    get(id) {
      const result = runner(["find-generic-password", "-a", id, "-s", service, "-w"]);
      if (result.status === 44) return undefined; // item not found
      if (result.status !== 0 || result.error) throw commandError("read", result);
      return result.stdout.replace(/[\r\n]+$/, "") || undefined;
    },
    set(id, value) {
      // `security` documents a trailing -w as the safe, prompted form. Its
      // prompt consumes stdin here; the credential is never a process arg.
      // New and updated generic-password items both request confirmation.
      const result = runner(
        ["add-generic-password", "-a", id, "-s", service, "-U", "-w"],
        `${value}\n${value}\n`,
      );
      if (result.status !== 0 || result.error) throw commandError("write", result);
    },
    delete(id) {
      const result = runner(["delete-generic-password", "-a", id, "-s", service]);
      if (result.status === 44) return;
      if (result.status !== 0 || result.error) throw commandError("delete", result);
    },
  };
}

/** Private file fallback for Windows/Linux and deterministic tests. The
 * macOS production path uses Keychain unless explicitly overridden. */
export function createFileSecretStore(dataDir: string): SecretStore {
  const file = join(dataDir, "secrets.json");
  const read = (): Partial<Record<SecretId, string>> => {
    if (!existsSync(file)) return {};
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  };
  const write = (value: Partial<Record<SecretId, string>>) =>
    writeFileAtomic(file, JSON.stringify(value, null, 2), { mode: 0o600 });

  return {
    get(id) {
      const value = read()[id];
      return typeof value === "string" && value ? value : undefined;
    },
    set(id, value) {
      write({ ...read(), [id]: value });
    },
    delete(id) {
      const next = read();
      if (!(id in next)) return;
      delete next[id];
      write(next);
    },
  };
}

export function createPlatformSecretStore(dataDir: string): SecretStore {
  const requested = process.env.OMB_SECRET_STORE;
  if (requested === "file") return createFileSecretStore(dataDir);
  if (requested === "keychain" && process.platform !== "darwin") {
    throw new Error("OMB_SECRET_STORE=keychain is only supported on macOS");
  }
  return process.platform === "darwin" ? createKeychainSecretStore() : createFileSecretStore(dataDir);
}
