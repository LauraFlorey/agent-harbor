import { chmodSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DATA_DIR,
  EVENTS_DIR,
  NATIVE_DIR,
  ensureDirs,
  instanceConfigs,
  loadConfig,
  saveConfig,
  type AppConfig,
} from "./config.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

describe("secure config storage", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    ensureDirs();
  });
  afterEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("repairs private state before config is read", () => {
    const config = join(DATA_DIR, "config.json");
    const messages = join(DATA_DIR, "messages-thread.json");
    const webhooks = join(DATA_DIR, "webhooks.json");
    const event = join(EVENTS_DIR, "thread.ndjson");
    const native = join(NATIVE_DIR, "thread.ndjson");
    for (const path of [config, messages, webhooks, event, native]) {
      writeFileSync(path, "{}", { mode: 0o644 });
      chmodSync(path, 0o644);
    }
    for (const path of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) chmodSync(path, 0o755);

    ensureDirs();

    for (const path of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) expect(mode(path)).toBe(0o700);
    for (const path of [config, messages, webhooks, event, native]) expect(mode(path)).toBe(0o600);
  });

  it("migrates legacy plaintext credentials and preserves ordinary settings", () => {
    const config = join(DATA_DIR, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        xai: { key: "xai_legacy", url: "https://example.test" },
        openrouter: { apiKey: "openrouter_legacy", url: "https://router.example.test" },
        composio: { key: "ck_legacy", apiKey: "ak_legacy", url: "https://connect.example.test" },
        box: { token: "box_legacy" },
        opencodeGo: { apiKey: "opencode_legacy" },
        tts: { key: "tts_legacy", voice: "voice-1" },
        profile: { name: "Test User", email: "test@example.test" },
      }),
    );

    const loaded = loadConfig();
    expect(loaded).toMatchObject({
      xai: { key: "xai_legacy", url: "https://example.test" },
      openrouter: { apiKey: "openrouter_legacy", url: "https://router.example.test" },
      composio: { key: "ck_legacy", apiKey: "ak_legacy", url: "https://connect.example.test" },
      box: { token: "box_legacy" },
      opencodeGo: { apiKey: "opencode_legacy" },
      tts: { key: "tts_legacy", voice: "voice-1" },
      profile: { name: "Test User", email: "test@example.test" },
    });

    const disk = JSON.parse(readFileSync(config, "utf8"));
    expect(disk).toEqual({
      xai: { url: "https://example.test" },
      openrouter: { url: "https://router.example.test" },
      composio: { url: "https://connect.example.test" },
      box: {},
      opencodeGo: {},
      tts: { voice: "voice-1" },
      profile: { name: "Test User", email: "test@example.test" },
    });
    const secrets = JSON.parse(readFileSync(join(DATA_DIR, "secrets.json"), "utf8"));
    expect(secrets).toEqual({
      "xai.key": "xai_legacy",
      "openrouter.apiKey": "openrouter_legacy",
      "composio.key": "ck_legacy",
      "composio.apiKey": "ak_legacy",
      "box.token": "box_legacy",
      "opencodeGo.apiKey": "opencode_legacy",
      "tts.key": "tts_legacy",
    });
  });

  it("saves new credentials outside config.json and can clear them", () => {
    saveConfig({
      openrouter: { apiKey: "openrouter_new" },
      composio: { key: "ck_new", apiKey: "ak_new", url: "https://connect.example.test" },
      opencodeGo: { apiKey: "opencode_new" },
      tts: { key: "tts_new", voice: "voice-2" },
    });

    const disk = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    expect(disk).toEqual({
      composio: { url: "https://connect.example.test" },
      tts: { voice: "voice-2" },
    });
    expect(JSON.stringify(disk)).not.toMatch(/openrouter_new|ck_new|ak_new|opencode_new|tts_new/);
    expect(loadConfig()).toMatchObject({
      openrouter: { apiKey: "openrouter_new" },
      composio: { key: "ck_new", apiKey: "ak_new" },
      opencodeGo: { apiKey: "opencode_new" },
      tts: { key: "tts_new", voice: "voice-2" },
    });

    saveConfig({ openrouter: { apiKey: "" }, composio: { key: "", apiKey: "" }, opencodeGo: { apiKey: "" }, tts: { key: "" } });
    expect(loadConfig().openrouter?.apiKey).toBeUndefined();
    expect(loadConfig().composio).toMatchObject({ key: undefined, apiKey: undefined });
    expect(loadConfig().opencodeGo?.apiKey).toBeUndefined();
    expect(loadConfig().tts?.key).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("refuses a symlink in place of private managed state", () => {
    const outside = join(DATA_DIR, "outside.json");
    writeFileSync(outside, JSON.stringify({ profile: { name: "Outside" } }));
    symlinkSync(outside, join(DATA_DIR, "config.json"));

    expect(() => loadConfig()).toThrow(/refusing symbolic link/);
  });
});

describe("OpenCode Go configuration", () => {
  it("injects the key only into OpenCode Go instances", () => {
    const cfg: AppConfig = {
      opencodeGo: { apiKey: "secret-value" },
      instances: {
        opencode: { driver: "opencodeGo" },
        grok: { driver: "grokAgent" },
      },
    };

    const instances = instanceConfigs(cfg);
    expect(instances.opencode.environment).toEqual({ OPENCODE_API_KEY: "secret-value" });
    expect(instances.grok.environment).toEqual({});
  });
});

describe("Box configuration", () => {
  it("injects the token only into the box agent instance", () => {
    const instances = instanceConfigs({
      box: { token: "box-secret" },
      instances: {
        computer: { driver: "boxAgent" },
        grok: { driver: "grokAgent" },
      },
    });

    expect(instances.computer.environment).toEqual({ BOX_TOKEN: "box-secret" });
    expect(instances.grok.environment).toEqual({});
  });
});

describe("OpenRouter configuration", () => {
  it("adds the default API provider and injects its key nowhere else", () => {
    const instances = instanceConfigs({ openrouter: { apiKey: "openrouter-secret" } });

    expect(instances.openrouter).toMatchObject({
      driver: "openrouter",
      environment: { OPENROUTER_API_KEY: "openrouter-secret" },
    });
    expect(instances.codex.environment).not.toHaveProperty("OPENROUTER_API_KEY");
  });

  it("injects the key only into explicitly configured OpenRouter instances", () => {
    const instances = instanceConfigs({
      openrouter: { apiKey: "openrouter-secret" },
      instances: {
        router: { driver: "openrouter" },
        grok: { driver: "grokAgent" },
      },
    });

    expect(instances.router.environment).toEqual({ OPENROUTER_API_KEY: "openrouter-secret" });
    expect(instances.grok.environment).toEqual({});
  });

  it("adds OpenRouter to an older customized fleet after the key is saved", () => {
    const cfg: AppConfig = {
      openrouter: { apiKey: "openrouter-secret" },
      instances: { custom: { driver: "codex", environment: { CUSTOM: "kept" } } },
    };

    const instances = instanceConfigs(cfg);
    expect(instances.custom.environment).toEqual({ CUSTOM: "kept" });
    expect(instances.openrouter).toMatchObject({
      driver: "openrouter",
      environment: { OPENROUTER_API_KEY: "openrouter-secret" },
    });
    expect(cfg.instances?.custom.environment).toEqual({ CUSTOM: "kept" });
  });
});
