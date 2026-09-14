import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, symlink, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTools, workspacePath } from "./action-tools.ts";
import { actionTurn } from "./action-turn.ts";
import { localModelUrl } from "./local-model.ts";
const dirs:string[]=[];
async function root(){const p=await mkdtemp(join(tmpdir(),"harbor-actions-"));dirs.push(p);return p;}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
describe("Local work",()=>{
  it("writes and retrieves Markdown, retaining an overwrite recovery copy",async()=>{
    const dir=await root(),tools=fileTools(dir),signal=new AbortController().signal;
    await tools[2].execute({path:"notes.md",text:"Original"},signal);
    await expect(tools[2].execute({path:"notes.md",text:"Wrong"},signal)).rejects.toThrow("File exists");
    await tools[2].execute({path:"notes.md",text:"Updated",overwrite:true},signal);
    expect(await tools[1].execute({path:"notes.md"},signal)).toMatchObject({text:"Updated"});
    const backup=(await readdir(dir)).find(n=>n.includes("backup"))!;
    expect(await readFile(join(dir,backup),"utf8")).toBe("Original");
  });
  it("rejects parent traversal, symlink escapes and credential files",async()=>{
    const dir=await root(),outside=await root();await writeFile(join(outside,"private.txt"),"private");
    await symlink(outside,join(dir,"escape"));
    await expect(workspacePath(dir,"../private.txt")).rejects.toThrow("outside");
    await expect(workspacePath(dir,"escape/private.txt")).rejects.toThrow("Symbolic");
    await expect(workspacePath(dir,".env",true)).rejects.toThrow("Credential");
  });
  it("does not write after cancellation or a denied approval",async()=>{
    const dir=await root(),abort=new AbortController();let closed=false;
    const bridge=actionTurn({tools:async()=>({tools:fileTools(dir),close:async()=>{closed=true;}}),authorize:async()=>false});
    await expect(bridge.run("t",abort.signal,c=>c.execute({id:"one",name:"harbor_write_file",arguments:{path:"blocked.md",text:"blocked"}}))).rejects.toThrow("denied");
    expect(await readdir(dir)).toEqual([]);expect(closed).toBe(true);
    abort.abort();await expect(fileTools(dir)[2].execute({path:"cancelled.md",text:"blocked"},abort.signal)).rejects.toThrow();
  });
  it("validates schemas and rejects replayed tool calls",async()=>{
    const dir=await root(),bridge=actionTurn({tools:async()=>({tools:fileTools(dir)}),authorize:async()=>true});
    await bridge.run("t",new AbortController().signal,async c=>{
      await expect(c.execute({id:"bad",name:"harbor_write_file",arguments:{path:"x"}})).rejects.toThrow("Invalid");
      const call={id:"read",name:"harbor_list_files",arguments:{}};
      expect((await c.execute(call)).isError).toBe(false);
      await expect(c.execute(call)).rejects.toThrow("Repeated");
    });
  });
  it("preserves structured MCP results when human-readable content is only a count", async () => {
    const bridge = actionTurn({
      authorize: async () => true,
      tools: async () => ({ tools: [{
        name: "computer_list_windows", description: "List windows", effect: "computer",
        inputSchema: { type: "object" },
        execute: async () => ({ content: [{ type: "text", text: "Found 1 window(s)." }], structuredContent: { windows: [{ id: 123, title: "Test guide" }] } }),
      }] }),
    });
    const result = await bridge.run("t", new AbortController().signal, context => context.execute({ id: "list", name: "computer_list_windows", arguments: {} }));
    expect(JSON.stringify(result.content)).toContain("Test guide");
    expect(result.content[0]).toEqual({ type: "text", text: "Found 1 window(s)." });
  });
});
describe("Local model privacy boundary",()=>{
  it("only accepts literal loopback HTTP endpoints",()=>{
    expect(localModelUrl()).toBe("http://127.0.0.1:1234/v1");
    expect(localModelUrl("http://127.0.0.1:11434/v1")).toContain("11434");
    for(const url of ["https://example.com/v1","http://localhost.example.com/v1","http://user:secret@127.0.0.1/v1","http://127.0.0.1/v1?token=x"]){expect(()=>localModelUrl(url)).toThrow();}
  });
});

describe("Local notes retrieval",()=>{
  it("searches nested Markdown without following vault links",async()=>{
    const dir=await root(),outside=await root();
    await writeFile(join(dir,"knowledge.md"),"The barn appointment is Tuesday.");
    await writeFile(join(outside,"private.md"),"Secret barn record");await symlink(outside,join(dir,"linked-vault"));
    const result=await fileTools(dir).find(t=>t.name==="harbor_search_notes")!.execute({query:"barn"},new AbortController().signal) as any;
    expect(result.matches).toHaveLength(1);expect(result.matches[0].path).toBe("knowledge.md");
  });
});
