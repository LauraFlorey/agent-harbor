import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { createApiSecurity } from "./api-security.ts";

it("keeps the owner credential out of public responses and denies other local callers", () => {
  const directory = mkdtempSync(join(tmpdir(), "ah-auth-"));
  const security = createApiSecurity(19000, directory, "http://127.0.0.1:5199");
  try {
    security.publish();
    const file = join(directory, 'session-19000.json');
    const { token } = JSON.parse(readFileSync(file, "utf8"));
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const req = (headers = {}, method = "GET") => ({ method, headers: { host: '127.0.0.1:19000', ...headers } } as IncomingMessage);
    for (const path of ["/api/bots", "/api/config", "/api/events"]) {
      expect(() => security.check(req(), path)).toThrow("authentication required");
      expect(() => security.check(req({ authorization: `Bearer ${'0'.repeat(64)}` }), path)).toThrow("authentication required");
      expect(() => security.check(req({ authorization: `Bearer ${token}` }), path)).not.toThrow();
    }
    expect(() => security.check(req({ authorization: `Bearer ${token}`, origin: "http://127.0.0.1:5555" }, "POST"), "/api/bots")).toThrow("cross-origin");
    expect(() => security.check(req({ authorization: `Bearer ${token}`, "content-type": "text/plain" }, "POST"), "/api/bots")).toThrow("application/json");
    expect(() => security.check(req(), '/api/health')).not.toThrow();
    expect(() => security.check(req({ origin: "http://127.0.0.1:5199" }), "/api/internal/agents")).toThrow("not a browser");
    const second = createApiSecurity(19000, directory);
    expect(() => second.check(req({ authorization: `Bearer ${token}` }), "/api/bots")).toThrow("authentication required");
  } finally { security.dispose(); rmSync(directory, { recursive: true, force: true }); }
});

describe("UI origin configuration", () => {
  it.each(["https://example.com", "http://127.0.0.1:5199/path", "http://user:pass@localhost:5199"])("rejects %s", (origin) => {
    expect(() => createApiSecurity(19000, '/unused', origin)).toThrow();
  });
});
