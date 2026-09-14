import { describe,it,expect,vi } from "vitest";
import { createOpenRouterDriver } from "./drivers/openrouter.ts";
import type { RuntimeEvent } from "./contracts.ts";
function sse(){return new Response('data: {"choices":[{"delta":{"content":"Local reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
describe("Local model transport",()=>{
 it("uses local discovery and completion, with no provider web tools or remote credentials",async()=>{
  const requests:Array<{url:string;init?:RequestInit}>=[];
  const driver=createOpenRouterDriver(async(input,init)=>{const url=String(input);requests.push({url,init});return url.endsWith('/models')?new Response(JSON.stringify({data:[{id:'openai/gpt-oss-20b'},{id:'text-embedding-example'}]})):sse();},true);
  const instance=await driver.create({instanceId:'local',displayName:'Local model',environment:{OPENROUTER_API_KEY:'must-not-leak'},enabled:true,config:driver.defaultConfig()});
  await instance.refreshModels?.();expect(instance.models.options.map(m=>m.id)).toEqual(['openai/gpt-oss-20b']);
  let finish!:(e:RuntimeEvent)=>void;const done=new Promise<RuntimeEvent>(r=>finish=r);
  instance.adapter.onEvent(e=>{if(e.type==='turn.completed')finish(e);});
  await instance.adapter.sendTurn({threadId:'local',text:'Hello',transcript:[{role:'assistant',text:'Seeded welcome copy'}],model:'openai/gpt-oss-20b',integrations:{webResearch:{maxUses:1,maxResults:1,maxTotalResults:1,searchContextSize:'low'}}});
  expect(await done).toMatchObject({ok:true});
  expect(JSON.stringify(requests)).not.toContain('Seeded welcome copy');
  expect(requests.every(r=>r.url.startsWith('http://127.0.0.1:1234/v1/'))).toBe(true);
  expect(JSON.stringify(requests)).not.toContain('must-not-leak');expect(JSON.parse(String(requests.at(-1)?.init?.body))).not.toHaveProperty('tools');
  expect(requests.every(r=>r.init?.redirect==='error')).toBe(true);
  await instance.dispose();
 });
 it("rejects a cloud address rather than silently treating it as local",()=>{
  const driver=createOpenRouterDriver(fetch,true);
  expect(()=>driver.decodeConfig({url:'https://openrouter.ai/api/v1'})).toThrow('local address');
 });
});


it("enables local vision only when the local server explicitly reports it", async () => {
 const {localModelSupportsVision}=await import("./local-model.ts");
 const mock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({models:[{key:"visual-model",capabilities:{vision:true}},{key:"text-model",capabilities:{vision:false}}]})));
 try {
  expect(await localModelSupportsVision("visual-model")).toBe(true);
  expect(mock.mock.calls[0][1]?.redirect).toBe("error");
  mock.mockResolvedValue(new Response(JSON.stringify({models:[{key:"text-model",capabilities:{vision:false}}]})));
  expect(await localModelSupportsVision("text-model")).toBe(false);
  mock.mockClear();
  expect(await localModelSupportsVision("visual-model","https://example.com/v1")).toBe(false);
  expect(mock).not.toHaveBeenCalled();
 } finally {mock.mockRestore();}
});
