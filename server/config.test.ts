import { chmodSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR, EVENTS_DIR, NATIVE_DIR, ensureDirs, loadConfig, saveConfig } from "./config.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

describe("secure config storage", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    ensureDirs();
  });

  it.skipIf(process.platform === "win32")("repairs private state before config is read", () => {
    const config = join(DATA_DIR, "config.json");
    const messages = join(DATA_DIR, "messages-thread.json");
    const event = join(EVENTS_DIR, "thread.ndjson");
    const native = join(NATIVE_DIR, "thread.ndjson");
    for (const path of [config, messages, event, native]) {
      writeFileSync(path, "{}", { mode: 0o644 });
      chmodSync(path, 0o644);
    }
    for (const path of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) chmodSync(path, 0o755);

    ensureDirs();

    for (const path of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) expect(mode(path)).toBe(0o700);
    for (const path of [config, messages, event, native]) expect(mode(path)).toBe(0o600);
  });

  it("migrates legacy plaintext credentials and preserves ordinary settings", () => {
    const config = join(DATA_DIR, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        xai: { key: "xai_legacy", url: "https://example.test" },
        composio: { key: "ck_legacy", apiKey: "ak_legacy", url: "https://connect.example.test" },
        box: { token: "box_legacy" },
        tts: { key: "tts_legacy", voice: "voice-1" },
        profile: { name: "Test User", email: "test@example.test" },
      }),
    );

    const loaded = loadConfig();
    expect(loaded).toMatchObject({
      xai: { key: "xai_legacy", url: "https://example.test" },
      composio: { key: "ck_legacy", apiKey: "ak_legacy", url: "https://connect.example.test" },
      box: { token: "box_legacy" },
      tts: { key: "tts_legacy", voice: "voice-1" },
      profile: { name: "Test User", email: "test@example.test" },
    });

    const disk = JSON.parse(readFileSync(config, "utf8"));
    expect(disk).toEqual({
      xai: { url: "https://example.test" },
      composio: { url: "https://connect.example.test" },
      box: {},
      tts: { voice: "voice-1" },
      profile: { name: "Test User", email: "test@example.test" },
    });
    const secrets = JSON.parse(readFileSync(join(DATA_DIR, "secrets.json"), "utf8"));
    expect(secrets).toEqual({
      "xai.key": "xai_legacy",
      "composio.key": "ck_legacy",
      "composio.apiKey": "ak_legacy",
      "box.token": "box_legacy",
      "tts.key": "tts_legacy",
    });
  });

  it("saves new credentials outside config.json and can clear them", () => {
    saveConfig({
      composio: { key: "ck_new", apiKey: "ak_new", url: "https://connect.example.test" },
      tts: { key: "tts_new", voice: "voice-2" },
    });

    const disk = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    expect(disk).toEqual({
      composio: { url: "https://connect.example.test" },
      tts: { voice: "voice-2" },
    });
    expect(JSON.stringify(disk)).not.toMatch(/ck_new|ak_new|tts_new/);
    expect(loadConfig()).toMatchObject({
      composio: { key: "ck_new", apiKey: "ak_new" },
      tts: { key: "tts_new", voice: "voice-2" },
    });

    saveConfig({ composio: { key: "", apiKey: "" }, tts: { key: "" } });
    expect(loadConfig().composio).toMatchObject({ key: undefined, apiKey: undefined });
    expect(loadConfig().tts?.key).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("refuses a symlink in place of private managed state", () => {
    const outside = join(DATA_DIR, "outside.json");
    writeFileSync(outside, JSON.stringify({ profile: { name: "Outside" } }));
    symlinkSync(outside, join(DATA_DIR, "config.json"));

    expect(() => loadConfig()).toThrow(/refusing symbolic link/);
  });
});
