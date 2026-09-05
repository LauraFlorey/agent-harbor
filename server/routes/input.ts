import { HttpError } from "../http.ts";

export function approvalResponse(body: Record<string, unknown>): { requestId: string; behavior: "allow" | "deny"; message?: string } {
  if (typeof body.requestId !== "string" || !body.requestId.trim() || body.requestId.length > 256) throw new HttpError(400, "requestId must be a non-empty string");
  if (body.behavior !== "allow" && body.behavior !== "deny") throw new HttpError(400, "behavior must be allow or deny");
  if (body.message !== undefined && (typeof body.message !== "string" || body.message.length > 64_000)) throw new HttpError(400, "message must be a bounded string");
  return { requestId: body.requestId, behavior: body.behavior, ...(body.message !== undefined ? { message: body.message as string } : {}) };
}

const CONFIG_FIELDS: Record<string, Record<string, "string" | "boolean">> = {
  xai: { key: "string", url: "string" }, openrouter: { apiKey: "string", url: "string", localVmEnabled: "boolean" },
  composio: { key: "string", apiKey: "string", url: "string" }, box: { token: "string" },
  opencodeGo: { apiKey: "string" }, tts: { key: "string", voice: "string" }, profile: { name: "string", email: "string" },
};

export function configPatch(body: Record<string, unknown>): Record<string, Record<string, string | boolean>> {
  const result: Record<string, Record<string, string | boolean>> = {};
  for (const [section, value] of Object.entries(body)) {
    if (!Object.hasOwn(CONFIG_FIELDS, section)) throw new HttpError(400, "unknown configuration section");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, `${section} must be an object`);
    const fields = CONFIG_FIELDS[section];
    const patch: Record<string, string | boolean> = {};
    for (const [field, item] of Object.entries(value)) {
      if (!Object.hasOwn(fields, field)) throw new HttpError(400, "unknown configuration field");
      if (typeof item !== fields[field]) throw new HttpError(400, `${section}.${field} must be ${fields[field] === "boolean" ? "true or false" : "a string"}`);
      if (typeof item === "string" && item.length > 16_384) throw new HttpError(400, "configuration value is too long");
      if (field === "url" && item) {
        try { const url = new URL(item as string); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
        catch { throw new HttpError(400, "provider URL must use HTTP or HTTPS without embedded credentials"); }
      }
      patch[field] = item as string | boolean;
    }
    result[section] = patch;
  }
  if (!Object.keys(result).length) throw new HttpError(400, "nothing to save");
  return result;
}
