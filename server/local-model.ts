/** A local-model address must never turn into an accidental cloud fallback. */
export function localModelUrl(value: unknown = "http://127.0.0.1:1234/v1"): string {
  if (typeof value !== "string") throw new Error("Local model address must be text");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Use a local address such as http://127.0.0.1:1234/v1");
  }
  return url.href.replace(/\/+$/, "");
}

/** Only an explicit capability from the local server enables visual inputs. */
export async function localModelSupportsVision(model: string, configuredUrl?: unknown): Promise<boolean> {
  try {
    const base = new URL(localModelUrl(configuredUrl));
    const response = await fetch(new URL("/api/v1/models", base), { signal: AbortSignal.timeout(3000), redirect: "error" });
    if (!response.ok) return false;
    const data = await response.json() as { models?: Array<{ key?: string; capabilities?: { vision?: boolean }; loaded_instances?: Array<{ id?: string }> }> };
    const match = data.models?.find(m => m.key === model || m.loaded_instances?.some(i => i.id === model));
    return match?.capabilities?.vision === true;
  } catch { return false; }
}
