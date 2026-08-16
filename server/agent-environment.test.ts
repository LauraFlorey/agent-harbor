import { describe, expect, it } from "vitest";

import { buildAgentEnvironment } from "./agent-environment.ts";

describe("buildAgentEnvironment", () => {
  it("keeps only operating-system context from the parent", () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/Users/test",
      TMPDIR: "/tmp/test",
      LANG: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      DATABASE_URL: "postgres://private",
      DEPLOY_TOKEN: "deploy-private",
      AWS_SECRET_ACCESS_KEY: "aws-private",
      CLOUDFLARE_API_TOKEN: "cf-private",
      GH_TOKEN: "gh-private",
      OPENAI_API_KEY: "openai-private",
      ANTHROPIC_API_KEY: "anthropic-private",
      XAI_API_KEY: "xai-private",
      NODE_OPTIONS: "--require /tmp/inject.js",
      LD_PRELOAD: "/tmp/inject.so",
      DYLD_INSERT_LIBRARIES: "/tmp/inject.dylib",
    };

    expect(buildAgentEnvironment({ parent })).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      TMPDIR: "/tmp/test",
      LANG: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
    });
  });

  it("adds only deliberate provider overrides without mutating the parent", () => {
    const parent = { PATH: "/usr/bin", HOME: "/home/test", OPENCODE_API_KEY: "wrong" };
    const env = buildAgentEnvironment({
      parent,
      overrides: {
        PATH: "/agent/bin",
        OPENCODE_API_KEY: "chosen",
        NPM_CONFIG_LOGLEVEL: "error",
      },
    });

    expect(env).toEqual({
      PATH: "/agent/bin",
      HOME: "/home/test",
      OPENCODE_API_KEY: "chosen",
      NPM_CONFIG_LOGLEVEL: "error",
    });
    expect(parent).toEqual({ PATH: "/usr/bin", HOME: "/home/test", OPENCODE_API_KEY: "wrong" });
  });

  it("replaces case-insensitive Windows keys instead of creating duplicates", () => {
    const env = buildAgentEnvironment({
      platform: "win32",
      parent: { Path: "C:\\Windows", SystemRoot: "C:\\Windows" },
      overrides: { PATH: "C:\\Agent" },
    });

    expect(env).toEqual({ SystemRoot: "C:\\Windows", PATH: "C:\\Agent" });
  });

  it("passes synthetic fixture controls only while Vitest is active", () => {
    const parent = { VITEST: "true", FAKE_CLAUDE_DUMP: "/tmp/dump", DATABASE_URL: "private" };
    expect(buildAgentEnvironment({ parent })).toEqual({ FAKE_CLAUDE_DUMP: "/tmp/dump" });
    expect(buildAgentEnvironment({ parent: { ...parent, VITEST: "" } })).toEqual({});
  });
});
