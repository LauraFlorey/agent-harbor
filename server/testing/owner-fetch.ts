import { readFileSync } from "node:fs";
import { join } from "node:path";

export function sessionHeaders(dataDir: string, port: number): Record<string, string> {
  const { token } = JSON.parse(readFileSync(join(dataDir, `session-${port}.json`), "utf8"));
  return { authorization: `Bearer ${token}` };
}

export function createOwnerFetch(base: string, dataDir: () => string): typeof fetch {
  return (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    if (url.origin === base) {
      if (!headers.has("authorization")) {
        try { headers.set("authorization", sessionHeaders(dataDir(), Number(url.port)).authorization); } catch { /* startup health probe */ }
      }
      if (!["GET", "HEAD"].includes(init.method ?? "GET") && !headers.has("content-type")) headers.set("content-type", "application/json");
    }
    return globalThis.fetch(input, { ...init, headers });
  };
}
