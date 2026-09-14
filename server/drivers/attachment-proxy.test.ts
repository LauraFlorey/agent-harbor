import { it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

it("passes native-agent attachment images through MCP with the bound conversation", async () => {
  let body: unknown;
  const stub = createServer((req, res) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      body = JSON.parse(data);
      expect(req.headers.authorization).toBe("Bearer test-attachment-token");
      expect(req.url).toBe("/api/internal/read-attachment");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: "Synthetic image" }, { type: "image", mimeType: "image/jpeg", data: "YWJj" }] }));
    });
  });
  await new Promise<void>(resolve => stub.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./agents-proxy.ts", import.meta.url))], { env: { ...process.env, OMB_HARNESS_URL: `http://127.0.0.1:${(stub.address() as { port: number }).port}`, OMB_COMMS_TOKEN: "test-attachment-token", OMB_BOT_ID: "owner", OMB_THREAD_ID: "task", OMB_ATTACHMENTS: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const response = new Promise<any>((resolve, reject) => {
      let data = "";
      child.stdout.on("data", chunk => { data += chunk; if (data.includes("\n")) resolve(JSON.parse(data.split("\n")[0])); });
      child.on("error", reject);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "harbor_read_attachment", arguments: { id: "attachment", action: "image" } } }) + "\n");
    const result = await response;
    expect(body).toEqual({ botId: "owner", threadId: "task", arguments: { id: "attachment", action: "image" } });
    expect(result.result.content[1]).toEqual({ type: "image", mimeType: "image/jpeg", data: "YWJj" });
  } finally { child.kill(); await new Promise<void>(resolve => stub.close(() => resolve())); }
});
