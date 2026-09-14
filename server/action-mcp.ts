import { buildAgentEnvironment } from "./agent-environment.ts";
import { spawnCli, killCliTree, drainCliTrees } from "./procs.ts";
import type { StdioMcpEndpoint } from "./contracts.ts";
import type { HarborTool } from "./action-tools.ts";

/** Trusted host/peer endpoint supplied by the application, never by a model. */
export async function actionMcp(endpoint: StdioMcpEndpoint, prefix: string, effect: HarborTool["effect"], signal: AbortSignal): Promise<{ tools: HarborTool[]; close: () => Promise<void> }> {
  signal.throwIfAborted();
  const child = spawnCli(endpoint.command, endpoint.args, { env: buildAgentEnvironment({ overrides: endpoint.env }), stdio: ["pipe","pipe","pipe"] });
  let sequence=0, buffer="", closed=false;
  const pending = new Map<number, {resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const stop = () => { if(closed)return; closed=true; for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error("Tool connection closed"));} pending.clear(); killCliTree(child); };
  signal.addEventListener("abort", stop, { once:true });
  child.on("error",stop);child.on("exit",stop);child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (part:string)=>{
    buffer+=part;if(Buffer.byteLength(buffer)>4_000_000){stop();return;}
    let newline;
    while((newline=buffer.indexOf("\n"))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
      try{
        const msg=JSON.parse(line), p=pending.get(msg.id);
        if(!p)continue; pending.delete(msg.id);clearTimeout(p.timer);
        if(msg.error)p.reject(new Error("Tool service rejected the request")); else p.resolve(msg.result);
      }catch{stop();return;}
    }
  });
  const rpc=(method:string,params:unknown={})=>new Promise<any>((resolve,reject)=>{
    if(closed || signal.aborted){reject(new Error("Tool connection closed"));return;}
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Tool request timed out"));stop();},method==="tools/call"?90_000:15_000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
  });
  const close=async()=>{signal.removeEventListener("abort",stop);stop();await drainCliTrees();};
  try{
    await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"Agent Harbor",version:"1"}});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
    const catalog=await rpc("tools/list");
    if(!Array.isArray(catalog?.tools)||catalog.tools.length>100)throw new Error("Invalid tool catalog");
    const desktopTools = new Set(["list_apps","list_windows","get_window_state","launch_app","bring_to_front","click","double_click","right_click","drag","type_text","press_key","hotkey","set_value","scroll","get_screen_size","get_cursor_position","move_cursor","check_permissions","get_accessibility_tree","zoom","page"]);
    const tools:HarborTool[]=catalog.tools.filter((tool:any)=>prefix!=="computer" || desktopTools.has(tool.name)).map((tool:any)=>{
      if(typeof tool.name!=="string"||!/^[-\w]{1,55}$/.test(tool.name)||!tool.inputSchema||typeof tool.inputSchema!=="object")throw new Error("Invalid tool definition");
      return {name:`${prefix}_${tool.name}`,description:String(tool.description??"").slice(0,3000),inputSchema:tool.inputSchema,effect: effect === "read" && tool.name !== "list_bots" ? "external" : effect,
        execute: async(args:Record<string,unknown>,s:AbortSignal)=>{s.throwIfAborted();return rpc("tools/call",{name:tool.name,arguments:args});}};
    });
    return {tools,close};
  }catch(error){await close();throw error;}
}
