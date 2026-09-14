import { redactSecrets } from "./redact.ts";
import { randomUUID } from "node:crypto";
import type { Store, BotRecord } from "./store.ts";
import type { ProviderToolCall } from "./contracts.ts";
import type { HarborTool } from "./action-tools.ts";
import { actionPermissionKey } from "./action-turn.ts";

export class ActionApprovals {
  private pending = new Map<string,{threadId:string;decide:(allow:boolean)=>void}>();
  private store: Store;
  private broadcast: (event:Record<string,unknown>)=>void;
  constructor(store:Store,broadcast:(event:Record<string,unknown>)=>void) {this.store=store;this.broadcast=broadcast;}
  resolve(threadId:string,requestId:unknown,behavior:unknown):boolean {
    const entry=typeof requestId==="string"?this.pending.get(requestId):undefined;
    if(!entry || entry.threadId!==threadId || !["allow","deny"].includes(String(behavior)))return false;
    entry.decide(behavior==="allow");return true;
  }
  async authorize(bot:BotRecord,threadId:string,tool:HarborTool,call:ProviderToolCall,signal:AbortSignal,unattended:boolean):Promise<boolean>{
    const current=this.store.bot(bot.id);
    if(!current || signal.aborted)return false;
    const key=actionPermissionKey(tool.name,call.arguments);
    const routine=tool.effect==="read"||tool.effect==="local-write";
    if(routine && (!unattended || current.autoRun === true))return true;
    if(tool.effect === "computer" && current.desktopAuto === true && !unattended)return true;
    if(current.alwaysAllow?.includes(key))return true;
    if(unattended)return false;
    const requestId=`action-${randomUUID()}`;
    const message=this.store.appendMessage(threadId,{role:"bot",kind:"options",card:{
      title:`${bot.name} requests an action`,subtitle:JSON.stringify(redactSecrets(call.arguments),null,2),options:["Allow","Deny"],tool:tool.name,requestId,allowKey:key,
      held:tool.effect==="command"?"This command can access files and the network with your Mac account's permissions.":"Approve this action once, or remember these exact arguments with Always allow.",
    }});
    return new Promise<boolean>(resolve=>{
      const finish=(allow:boolean)=>{
        if(!this.pending.delete(requestId))return;
        clearTimeout(timer);signal.removeEventListener("abort",cancel);
        const patched=this.store.patchMessage(threadId,message.id,{card:{...message.card!,answered:allow?"allow":"deny"}});
        if(patched)this.broadcast({kind:"message.patch",threadId,message:patched});resolve(allow);
      };
      const cancel=()=>finish(false);
      const timer=setTimeout(cancel,10*60_000);
      this.pending.set(requestId,{threadId,decide:finish});signal.addEventListener("abort",cancel,{once:true});
      if(signal.aborted)cancel();else this.broadcast({kind:"message",threadId,message});
    });
  }
}
