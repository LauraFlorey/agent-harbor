import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { HttpError } from "./http.ts";

export function createApiSecurity(port: number, dataDir: string, uiOrigin?: string) {
  const token = randomBytes(32).toString("hex");
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (uiOrigin) {
    const ui = new URL(uiOrigin);
    if (ui.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(ui.hostname) || ui.origin !== uiOrigin) {
      throw new Error("OMB_UI_ORIGIN must be an exact loopback HTTP origin");
    }
    origins.add(uiOrigin);
  }
  const file = join(dataDir, `session-${port}.json`);
  return {
    /** Only publish after successfully binding; a failed second server cannot replace it. */
    publish() { writeFileAtomic(file, JSON.stringify({ token, pid: process.pid, port }), { mode: 0o600 }); },
    dispose() {
      try { if (JSON.parse(readFileSync(file, "utf8")).token === token) unlinkSync(file); } catch { /* already removed */ }
    },
    check(req: IncomingMessage, path: string) {
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host ?? "")) {
        throw new HttpError(403, "forbidden: unexpected host");
      }
      if (req.headers.origin && !origins.has(req.headers.origin)) throw new HttpError(403, "forbidden: cross-origin request");
      if (req.method === "GET" && path === "/api/health") return;
      if (!path.startsWith("/api/")) return; // static UI contains no session credential
      if (path.startsWith("/api/internal/")) {
        if (req.headers.origin) throw new HttpError(403, "internal API is not a browser endpoint");
        return; // separate agent credential, validated by the internal routes
      }
      const supplied = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!supplied || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) throw new HttpError(401, "workspace authentication required");
      if (!["GET", "HEAD"].includes(req.method ?? "GET") && req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new HttpError(415, "application/json required");
      }
    },
  };
}

export const PRODUCTION_CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", "font-src 'self' data:", "media-src 'self' blob: data:",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
].join("; ");
