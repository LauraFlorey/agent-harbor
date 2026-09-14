import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import type { ServerToolTurnBridge, ProviderToolCall, ProviderToolResult } from "./contracts.ts";
import type { HarborTool } from "./action-tools.ts";
import { ToolApprovalError } from "./tool-approval.ts";

export function actionPermissionKey(tool: string, args: Record<string, unknown>): string {
  return `action:${tool}:${createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 32)}`;
}
export interface ActionTurnOptions {
  tools: (signal: AbortSignal) => Promise<{ tools: HarborTool[]; close?: () => Promise<void> }>;
  authorize: (tool: HarborTool, call: ProviderToolCall, signal: AbortSignal) => Promise<boolean>;
  timeoutMs?: number;
}

/** One bounded, serial tool session; the provider cannot supply tools or authority. */
export function actionTurn(options: ActionTurnOptions): ServerToolTurnBridge {
  return { async run(_turnId, parentSignal, operation) {
    const abort = new AbortController();
    const forward = () => abort.abort(parentSignal.reason);
    if(parentSignal.aborted) forward(); else parentSignal.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => abort.abort(new Error("The action task reached its time limit")), options.timeoutMs ?? 20 * 60_000);
    let resource: Awaited<ReturnType<ActionTurnOptions["tools"]>> | undefined;
    try {
      abort.signal.throwIfAborted();
      resource = await options.tools(abort.signal);
      const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: false });
      const draft7 = new Ajv({ strict:false,allErrors:false,validateFormats:false });
      const entries = new Map(resource.tools.map(tool => [tool.name, { tool, validate: (String(tool.inputSchema.$schema??"").includes("draft-07") ? draft7 : ajv).compile(tool.inputSchema) }]));
      if(entries.size !== resource.tools.length || entries.size > 128) throw new Error("Invalid action tool catalog");
      const seen = new Set<string>();
      let count = 0;
      let running = false;
      return await operation({ tools: resource.tools.map(({name,description,inputSchema})=>({name,description,inputSchema})), signal: abort.signal,
        execute: async (call): Promise<ProviderToolResult> => {
          abort.signal.throwIfAborted();
          if(running) throw new Error("Action tools must run one at a time");
          if(++count > 80) throw new Error("The task reached its 80-action limit");
          if(seen.has(call.id)) throw new Error("Repeated action request");
          seen.add(call.id);
          const entry = entries.get(call.name);
          if(!entry || JSON.stringify(call.arguments).length > 256_000 || !entry.validate(call.arguments)) throw new Error("Invalid action arguments");
          running = true;
          try {
            if(!await options.authorize(entry.tool, call, abort.signal)) throw new ToolApprovalError("approval_denied", "Action denied");
            abort.signal.throwIfAborted();
            const value = await entry.tool.execute(call.arguments, abort.signal);
            abort.signal.throwIfAborted();
            // MCP content is kept structured for vision-capable models.
            if(value && typeof value === "object" && "content" in value && Array.isArray(value.content)) {
              const result = value as { content: ProviderToolResult["content"]; structuredContent?: unknown; isError?: boolean };
              if (JSON.stringify(result).length > 2_000_000) throw new Error("Action result exceeds 2 MB");
              const content = [...result.content];
              if (result.structuredContent !== undefined) {
                const text = JSON.stringify(result.structuredContent);
                if (!content.some(item => item.type === "text" && item.text === text)) {
                  content.push({ type: "text", text });
                }
              }
              return { callId: call.id, content, isError: result.isError === true };
            }
            const text = JSON.stringify(value);
            return {callId:call.id,content:[{type:"text",text:text.slice(0,256_000)}],isError:false};
          } catch(error) {
            if(error instanceof ToolApprovalError || abort.signal.aborted) throw error;
            return {callId:call.id,content:[{type:"text",text:error instanceof Error ? error.message.slice(0,500) : "Action failed"}],isError:true};
          } finally {running=false;}
        }
      });
    } finally {
      clearTimeout(timer); parentSignal.removeEventListener("abort", forward); abort.abort(); await resource?.close?.();
    }
  } };
}
