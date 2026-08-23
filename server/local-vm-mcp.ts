import type { StdioMcpEndpoint } from "./contracts.ts";

declare const LOCAL_VM_ENDPOINT: unique symbol;
const localVmEndpoints = new WeakSet<object>();

/** An MCP endpoint that was created only after the harness selected and
 * leased Agent Harbor's isolated Local VM. The brand exists only in a private
 * WeakSet, so it cannot leak through reflection, serialization, or provider
 * MCP configuration objects. */
export interface LocalVmMcpEndpoint extends StdioMcpEndpoint {
  readonly [LOCAL_VM_ENDPOINT]: true;
}

export function localVmMcpEndpoint(endpoint: StdioMcpEndpoint): LocalVmMcpEndpoint {
  const args = Object.freeze([...endpoint.args]);
  const env = Object.freeze({ ...endpoint.env });
  const branded = Object.freeze({
    command: endpoint.command,
    args,
    env,
  }) as unknown as LocalVmMcpEndpoint;
  localVmEndpoints.add(branded);
  return branded;
}

export function isLocalVmMcpEndpoint(endpoint: StdioMcpEndpoint): endpoint is LocalVmMcpEndpoint {
  return typeof endpoint === "object" && endpoint !== null && localVmEndpoints.has(endpoint);
}
