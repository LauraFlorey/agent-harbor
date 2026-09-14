import { spawnCli, killCliTree } from "./procs.ts";
import { buildAgentEnvironment } from "./agent-environment.ts";
import type { HarborTool } from "./action-tools.ts";

export interface JinxConnection { host: string; root: string }
export function decodeJinxConnection(raw: unknown): JinxConnection {
  const value = raw as Partial<JinxConnection> | undefined;
  if (!value || typeof value.host !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,150}$/.test(value.host)) throw new Error("Choose a configured SSH host for Jinx");
  if (typeof value.root !== "string" || !value.root.startsWith("/") || value.root.length > 1000 || /[\r\n\0]/.test(value.root)) throw new Error("Choose Jinx's absolute folder on that host");
  return { host: value.host, root: value.root.replace(/\/+$/, "") };
}
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const routes = new Set(["/status", "/models", "/models/user", "/tools", "/tool", "/chat/completions", "/archive"]);

/** Keep the private bridge bounded as a long PDF/video review accumulates images.
 * Originals stay in Harbor; Jinx can request a previous page again. */
export function boundJinxImages(body: unknown): unknown {
  if (!body || typeof body !== "object" || !Array.isArray((body as { messages?: unknown }).messages)) return body;
  const value = structuredClone(body) as { messages: Array<{ content?: unknown }> };
  const pictures: Array<{ content: Array<Record<string, unknown>>; index: number }> = [];
  for (const message of value.messages) {
    if (!Array.isArray(message.content)) continue;
    const content = message.content as Array<Record<string, unknown>>;
    content.forEach((part, index) => { if (part.type === "image_url") pictures.push({ content, index }); });
  }
  while (pictures.length > 1 && Buffer.byteLength(JSON.stringify(value)) > 1_650_000) {
    const oldest = pictures.shift()!;
    oldest.content[oldest.index] = { type: "text", text: "[Earlier image omitted from this follow-up request to keep the connection within its size limit. Request its attachment/page/frame again if needed; do not infer unseen details.]" };
  }
  return value;
}

/** SSH transports the request; the Mini owns its bridge and provider credentials. */
export function jinxRequest(config: JinxConnection, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  if (!routes.has(path)) return Promise.reject(new Error("Unknown Jinx route"));
  signal?.throwIfAborted();
  const request = JSON.stringify({ path, ...(body === undefined ? {} : { body: path === "/chat/completions" ? boundJinxImages(body) : body }) });
  if (Buffer.byteLength(request) > 1_900_000) return Promise.reject(new Error("Jinx request is too large"));
  return new Promise((resolve, reject) => {
    const child = spawnCli("/usr/bin/ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2", config.host,
      "/opt/homebrew/bin/python3 " + quote(config.root + "/integrations/agent_harbor/relay.py")],
    { env: buildAgentEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    let header = Buffer.alloc(0), controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let received = false, finished = false, bytes = 0;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true; cleanup(); killCliTree(child);
      if (received) controller?.error(error); else reject(error);
    };
    const cancel = () => fail(new DOMException("Jinx request cancelled", "AbortError"));
    const timer = setTimeout(() => fail(new Error("Jinx on the Mini took too long to respond")), 250_000);
    signal?.addEventListener("abort", cancel, { once: true });
    child.stderr.resume();
    child.on("error", () => fail(new Error("Could not connect to Jinx on the Mini")));
    child.stdin.on("error", () => fail(new Error("Jinx connection closed")));
    child.stdout.on("data", (part: Buffer) => {
      if (finished) return;
      bytes += part.length;
      if (bytes > 8_000_000) return fail(new Error("Jinx response is too large"));
      if (received) { controller!.enqueue(new Uint8Array(part)); return; }
      header = Buffer.concat([header, part]);
      const newline = header.indexOf(10);
      if (newline < 0) { if (header.length > 4096) fail(new Error("Invalid Jinx response")); return; }
      try {
        const meta = JSON.parse(header.subarray(0, newline).toString());
        if (!Number.isInteger(meta.status) || meta.status < 200 || meta.status > 599) throw new Error();
        const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel });
        received = true;
        resolve(new Response(stream, { status: meta.status, headers: { "content-type": String(meta.contentType) } }));
        const rest = header.subarray(newline + 1);
        if (rest.length) controller!.enqueue(new Uint8Array(rest));
        header = Buffer.alloc(0);
      } catch { fail(new Error("Invalid Jinx response")); }
    });
    child.on("close", code => {
      if (finished) return;
      if (code !== 0 || !received) return fail(new Error("Jinx is unavailable. Check that the Mac Mini is awake and its Jinx service is running."));
      finished = true; cleanup(); controller!.close();
    });
    child.stdin.end(request + "\n");
    if (signal?.aborted) cancel();
  });
}

export async function jinxJson(config: JinxConnection, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const response = await jinxRequest(config, path, body, signal);
  const result: any = await response.json();
  if (!response.ok) throw new Error(result?.error?.message ?? `Jinx returned HTTP ${response.status}`);
  return result;
}

const readTools = new Set(["ask_librarian", "search_memory", "inspect_code", "read_cold_file", "list_cold_directory", "read_file", "list_directory", "fetch_url", "search_archive", "tail_log", "youtube_transcript", "search_hq_library", "list_hq_contacts", "list_hq_tasks", "search_open_brain_archive", "browse_open_brain_archive", "read_open_brain_archive_item", "read_openrouter_costs", "get_hq_status"]);
export async function jinxActionTools(config: JinxConnection, signal: AbortSignal): Promise<HarborTool[]> {
  const catalog = await jinxJson(config, "/tools", undefined, signal);
  if (!Array.isArray(catalog.tools) || catalog.tools.length > 50) throw new Error("Invalid Jinx tool catalog");
  return catalog.tools.map((tool: any): HarborTool => {
    if (!/^jinx_[a-z_]{1,60}$/.test(tool.name) || tool.effect === "destructive") throw new Error("Invalid Jinx tool");
    const read = readTools.has(tool.name.slice(5)) && tool.effect === "read";
    return { name: tool.name, description: String(tool.description).slice(0,4000), inputSchema: tool.inputSchema, effect: read ? "read" : "external",
      execute: async (args, signal) => jinxJson(config, "/tool", { name: tool.name, argument: args.argument, approved: !read }, signal) };
  });
}
