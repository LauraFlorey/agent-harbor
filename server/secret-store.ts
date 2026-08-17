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
export type KeychainWriteRunner = (account: string, service: string, value: string) => SecurityCommandResult;

const KEYCHAIN_SERVICE = "com.openmausbot.app.secrets";

// `security add-generic-password -w` deliberately reads from a TTY. The
// harness server has no TTY, so piping the value directly leaves `security`
// waiting forever. macOS ships Expect; it creates the private pseudo-terminal
// that the command requires while the credential itself still enters Expect
// over stdin and never appears in argv, the environment, or logs.
const KEYCHAIN_WRITE_EXPECT = String.raw`
log_user 0
set timeout 8
set secret [read -nonewline stdin]
spawn -noecho /usr/bin/security add-generic-password -a $env(AGENT_HARBOR_KEYCHAIN_ACCOUNT) -s $env(AGENT_HARBOR_KEYCHAIN_SERVICE) -U -w
expect {
  -re {password data for new item:} {
    send -- "$secret\r"
    exp_continue
  }
  -re {retype password for new item:} {
    send -- "$secret\r"
    exp_continue
  }
  eof {
    set result [wait]
    exit [lindex $result 3]
  }
  timeout {
    exit 124
  }
}`;

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

const writeSecurityPassword: KeychainWriteRunner = (account, service, value) => {
  const result = spawnSync("/usr/bin/expect", ["-c", KEYCHAIN_WRITE_EXPECT], {
    encoding: "utf8",
    input: value,
    timeout: 12_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      LANG: "C",
      LC_ALL: "C",
      AGENT_HARBOR_KEYCHAIN_ACCOUNT: account,
      AGENT_HARBOR_KEYCHAIN_SERVICE: service,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
};

function commandError(action: string, result: SecurityCommandResult): Error {
  if (result.status === 124 || result.error?.message.includes("ETIMEDOUT")) {
    return new Error(`macOS Keychain ${action} timed out. Unlock your login Keychain and try again.`);
  }
  const detail = result.error?.message || result.stderr.trim() || `exit status ${String(result.status)}`;
  return new Error(`macOS Keychain ${action} failed: ${detail}`);
}

/** macOS login-keychain store. Secret values are supplied on stdin instead
 * of argv so they never appear in `ps` output. */
export function createKeychainSecretStore(
  runner: SecurityCommandRunner = runSecurity,
  service = KEYCHAIN_SERVICE,
  writer: KeychainWriteRunner = writeSecurityPassword,
): SecretStore {
  return {
    get(id) {
      const result = runner(["find-generic-password", "-a", id, "-s", service, "-w"]);
      if (result.status === 44) return undefined; // item not found
      if (result.status !== 0 || result.error) throw commandError("read", result);
      return result.stdout.replace(/[\r\n]+$/, "") || undefined;
    },
    set(id, value) {
      const result = writer(id, service, value);
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
