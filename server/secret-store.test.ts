import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFileSecretStore,
  createKeychainSecretStore,
  type SecurityCommandResult,
} from "./secret-store.ts";

describe("secret stores", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps file-fallback credentials in a private file", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-secrets-"));
    dirs.push(dir);
    const store = createFileSecretStore(dir);
    store.set("box.token", "box_test_value");

    const path = join(dir, "secrets.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ "box.token": "box_test_value" });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.get("box.token")).toBe("box_test_value");

    store.delete("box.token");
    expect(store.get("box.token")).toBeUndefined();
  });

  it("passes Keychain writes privately to the prompted writer", () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const writes: Array<{ account: string; service: string; value: string }> = [];
    const runner = (args: string[], input?: string): SecurityCommandResult => {
      calls.push({ args, input });
      if (args[0] === "find-generic-password") return { status: 0, stdout: "stored-value\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const writer = (account: string, service: string, value: string): SecurityCommandResult => {
      writes.push({ account, service, value });
      return { status: 0, stdout: "", stderr: "" };
    };
    const store = createKeychainSecretStore(runner, "test.openmausbot", writer);

    store.set("composio.key", "credential-that-must-not-be-in-argv");
    expect(calls).toEqual([]);
    expect(writes).toEqual([
      {
        account: "composio.key",
        service: "test.openmausbot",
        value: "credential-that-must-not-be-in-argv",
      },
    ]);
    expect(store.get("composio.key")).toBe("stored-value");
    store.delete("composio.key");
  });

  it("turns a prompted Keychain timeout into actionable guidance", () => {
    const store = createKeychainSecretStore(
      () => ({ status: 0, stdout: "", stderr: "" }),
      "test.openmausbot",
      () => ({ status: 124, stdout: "", stderr: "" }),
    );

    expect(() => store.set("openrouter.apiKey", "test-value")).toThrow(
      "macOS Keychain write timed out. Unlock your login Keychain and try again.",
    );
  });

  it("treats a missing Keychain item as unconfigured", () => {
    const store = createKeychainSecretStore(
      () => ({ status: 44, stdout: "", stderr: "security: SecKeychainSearchCopyNext: item not found" }),
      "test.openmausbot",
    );
    expect(store.get("xai.key")).toBeUndefined();
    expect(() => store.delete("xai.key")).not.toThrow();
  });
});
