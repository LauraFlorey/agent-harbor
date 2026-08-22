import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { allowedExternalUrl } = require("./external-url.cjs");

describe("external URL policy", () => {
  it.each([
    "https://example.com/path",
    "http://127.0.0.1:8799/help",
    "mailto:owner@example.com",
  ])("allows %s", (url) => {
    expect(allowedExternalUrl(url)).toBe(true);
  });

  it.each([
    "file:///Users/example/.ssh/id_ed25519",
    "smb://fileserver/private",
    "javascript:alert(1)",
    "custom-handler://do-something",
    "not a url",
  ])("denies %s", (url) => {
    expect(allowedExternalUrl(url)).toBe(false);
  });
});
