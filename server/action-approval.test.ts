import { describe,it,expect } from "vitest";
import { ActionApprovals } from "./action-approval.ts";
import { actionPermissionKey } from "./action-turn.ts";
import type { BotRecord, Store } from "./store.ts";
import type { HarborTool } from "./action-tools.ts";
function setup(){
 const bot={id:"b",name:"Bot",alwaysAllow:[]} as unknown as BotRecord;
 const messages:any[]=[];const frames:any[]=[];
 const store={bot:()=>bot,appendMessage:(_t:string,m:any)=>{m.id="message";messages.push(m);return m;},patchMessage:(_t:string,_id:string,m:any)=>m} as unknown as Store;
 const approvals=new ActionApprovals(store,e=>frames.push(e));
 const tool={name:"action",effect:"external"} as HarborTool;
 const call={id:"call",name:"action",arguments:{value:"one"}};
 return {bot,messages,frames,approvals,tool,call};
}
describe("Standing action permissions",()=>{
 it("requires a separate opt-in for unattended note work",async()=>{
  const s=setup();s.tool.effect="local-write";
  expect(await s.approvals.authorize(s.bot,"t",s.tool,s.call,new AbortController().signal,true)).toBe(false);
  s.bot.autoRun=true;
  expect(await s.approvals.authorize(s.bot,"t",s.tool,s.call,new AbortController().signal,true)).toBe(true);
 });
 it("binds a remembered action to exact arguments",async()=>{
  const s=setup();s.bot.alwaysAllow=[actionPermissionKey(s.call.name,s.call.arguments)];
  expect(await s.approvals.authorize(s.bot,"t",s.tool,s.call,new AbortController().signal,true)).toBe(true);
  expect(await s.approvals.authorize(s.bot,"t",s.tool,{...s.call,arguments:{value:"two"}},new AbortController().signal,true)).toBe(false);
 });
 it("rejects cross-thread approval and closes on cancellation",async()=>{
  const s=setup(),abort=new AbortController();
  const done=s.approvals.authorize(s.bot,"t",s.tool,s.call,abort.signal,false);
  const request=s.messages[0].card.requestId;
  expect(s.approvals.resolve("wrong",request,"allow")).toBe(false);
  abort.abort();expect(await done).toBe(false);expect(s.approvals.resolve("t",request,"allow")).toBe(false);
 });
 it("desktop standing permission does not authorize commands or unattended clicks",async()=>{
  const s=setup();s.bot.desktopAuto=true;s.tool.effect="computer";
  expect(await s.approvals.authorize(s.bot,"t",s.tool,s.call,new AbortController().signal,false)).toBe(true);
  expect(await s.approvals.authorize(s.bot,"t",s.tool,s.call,new AbortController().signal,true)).toBe(false);
  s.tool.effect="command";
  expect(await s.approvals.authorize(s.bot,"t",s.tool,s.call,new AbortController().signal,true)).toBe(false);
 });
});
