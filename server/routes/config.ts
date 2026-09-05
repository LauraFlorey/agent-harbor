import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, saveConfig, type AppConfig } from "../config.ts";
import * as box from "../box.ts";
import * as tts from "../tts/index.ts";
import { json, readBody } from "../http.ts";
import { configPatch } from "./input.ts";

interface ConfigRouteContext {
  config: AppConfig;
  status: () => Record<string, unknown>;
  reloadProviders: () => Promise<void>;
  cancelLocalVmTurns: () => Promise<void>;
  broadcast: (event: Record<string, unknown>) => void;
}

export async function handleConfigRoute(req: IncomingMessage, res: ServerResponse, path: string, context: ConfigRouteContext): Promise<boolean> {
  if (path !== "/api/config") return false;
  if (req.method === "GET") { json(res, 200, context.status()); return true; }
  if (req.method !== "PUT" && req.method !== "PATCH") return false;
  const patch = configPatch(await readBody(req));
  const token = patch.box?.token;
  if (typeof token === "string" && token.trim()) {
    const check = await box.verifyToken(token.trim());
    if (!check.ok) { json(res, 400, { error: check.message }); return true; }
  }
  const voiceKey = patch.tts?.key;
  if (typeof voiceKey === "string" && voiceKey.trim()) {
    const check = await tts.verifyKey(voiceKey.trim());
    if (!check.ok) { json(res, 400, { error: check.message }); return true; }
  }
  const disablingVm = context.config.openrouter?.localVmEnabled === true && patch.openrouter?.localVmEnabled === false;
  const toggleOnly = Object.keys(patch).length === 1 && patch.openrouter !== undefined && Object.keys(patch.openrouter).every((key) => key === "localVmEnabled");
  saveConfig(patch);
  Object.assign(context.config, loadConfig());
  if (disablingVm) await context.cancelLocalVmTurns();
  if (!toggleOnly && Object.keys(patch).some((key) => key !== "profile" && key !== "tts")) await context.reloadProviders();
  const status = context.status();
  context.broadcast({ kind: "config", ...status });
  json(res, 200, status);
  return true;
}
