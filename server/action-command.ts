import { spawnCli, killCliTree, drainCliTrees } from "./procs.ts";
import { buildAgentEnvironment } from "./agent-environment.ts";
import type { HarborTool } from "./action-tools.ts";

/** Commands always require a concrete approval; cwd is not a shell sandbox. */
export function commandTool(cwd:string):HarborTool {
  return {name:"harbor_run_command",description:"Run a command on this Mac after owner approval. The working folder is the agent's permitted folder, but the command has the owner's OS permissions. Use file tools for ordinary notes. Never request credentials or change permissions.",effect:"command",inputSchema:{type:"object",properties:{command:{type:"string",minLength:1,maxLength:12000}},required:["command"],additionalProperties:false},
    execute:async(args,signal)=>{
      signal.throwIfAborted();
      const child=spawnCli(process.platform==="win32"?"cmd.exe":"/bin/sh",process.platform==="win32"?["/c",String(args.command)]:["-c",String(args.command)],{cwd,env:buildAgentEnvironment(),stdio:["pipe","pipe","pipe"]});
      let text="",bytes=0;
      const cancel=()=>killCliTree(child);
      signal.addEventListener("abort",cancel,{once:true});
      let timedOut=false;
      const timeout=setTimeout(()=>{timedOut=true;cancel();},60_000);
      const collect=(data:Buffer)=>{bytes+=data.length;if(bytes>256_000){cancel();return;}text+=data.toString("utf8");};
      child.stdout.on("data",collect);child.stderr.on("data",collect);child.stdin.end();
      try{
        const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});
        signal.throwIfAborted();
        return {exitCode,output:text,truncated:bytes>256_000,timedOut};
      }finally{clearTimeout(timeout);signal.removeEventListener("abort",cancel);killCliTree(child);await drainCliTrees();}
    }};
}
