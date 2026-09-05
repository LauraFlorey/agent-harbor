import type {
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
} from "./contracts.ts";
import { ToolApprovalError } from "./tool-approval.ts";

export type ProviderLoopMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: readonly ProviderToolCall[] }
  | { role: "tool"; result: ProviderToolResult };

export interface ProviderLoopCompletion {
  text: string;
  toolCalls: ProviderToolCall[];
  finishReason: string | null;
  usage: { input: number; output: number } | null;
}

export interface ProviderToolLoopOptions {
  messages: readonly ProviderLoopMessage[];
  tools: readonly ProviderToolDefinition[];
  signal: AbortSignal;
  complete(input: {
    messages: readonly ProviderLoopMessage[];
    tools?: readonly ProviderToolDefinition[];
    signal: AbortSignal;
    onTextDelta: (delta: string) => void;
  }): Promise<ProviderLoopCompletion>;
  execute(call: ProviderToolCall): Promise<ProviderToolResult>;
  onTextDelta?: (delta: string) => void;
  onToolStarted?: (call: ProviderToolCall) => void;
  onToolCompleted?: (call: ProviderToolCall, ok: boolean) => void;
}

export interface ProviderToolLoopResult {
  text: string;
  usage: { input: number; output: number } | null;
  denied: boolean;
}

function addUsage(
  total: { input: number; output: number } | null,
  next: { input: number; output: number } | null,
): { input: number; output: number } | null {
  if (!next) return total;
  const prior = total ?? { input: 0, output: 0 };
  return {
    input: Math.min(Number.MAX_SAFE_INTEGER, prior.input + Math.max(0, next.input)),
    output: Math.min(Number.MAX_SAFE_INTEGER, prior.output + Math.max(0, next.output)),
  };
}

function denialResult(callId: string): ProviderToolResult {
  return Object.freeze({
    callId,
    content: [{ type: "text" as const, text: "Denied by the user." }],
    isError: true,
  });
}

/** Never forward an MCP-provided failure body to a model continuation. */
export function providerSafeToolResult(
  call: ProviderToolCall,
  result: ProviderToolResult,
): ProviderToolResult {
  if (result.isError) {
    return {
      callId: call.id,
      content: [{ type: "text", text: "The Local VM action failed." }],
      isError: true,
    };
  }
  return result.callId === call.id ? result : { ...result, callId: call.id };
}

function isExplicitDenial(error: unknown): boolean {
  return error instanceof ToolApprovalError && error.code === "approval_denied";
}

/** Provider-neutral model/tool continuation. Destination selection, MCP
 * ownership, approval authority, limits, and cleanup stay outside this loop. */
export async function runProviderToolLoop(
  options: ProviderToolLoopOptions,
): Promise<ProviderToolLoopResult> {
  const messages: ProviderLoopMessage[] = [...options.messages];
  const textParts: string[] = [];
  let usage: { input: number; output: number } | null = null;
  let denied = false;

  for (;;) {
    options.signal.throwIfAborted();
    const completion = await options.complete({
      messages,
      // An empty set keeps the denial continuation tool-free on the wire
      // while asking transports to retain strict tool-event parsing.
      tools: denied ? Object.freeze([]) : options.tools,
      signal: options.signal,
      onTextDelta: (delta) => options.onTextDelta?.(delta),
    });
    usage = addUsage(usage, completion.usage);
    if (completion.text.trim()) textParts.push(completion.text);

    if (completion.toolCalls.length === 0) {
      return { text: textParts.join("\n\n"), usage, denied };
    }
    if (denied) {
      throw new Error("OpenRouter requested another tool after the user denied execution");
    }
    if (completion.finishReason !== "tool_calls") {
      throw new Error("OpenRouter returned tool calls with an inconsistent finish reason");
    }

    messages.push(Object.freeze({
      role: "assistant" as const,
      content: completion.text,
      toolCalls: Object.freeze([...completion.toolCalls]),
    }));

    for (const call of completion.toolCalls) {
      options.signal.throwIfAborted();
      options.onToolStarted?.(call);
      let result: ProviderToolResult;
      try {
        result = await options.execute(call);
      } catch (error) {
        if (!isExplicitDenial(error)) {
          options.onToolCompleted?.(call, false);
          throw error;
        }
        denied = true;
        result = denialResult(call.id);
      }
      options.onToolCompleted?.(call, !result.isError);
      messages.push(Object.freeze({ role: "tool" as const, result }));
    }
  }
}
