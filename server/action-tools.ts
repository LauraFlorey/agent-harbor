import { constants, promises as fs } from "node:fs";
import { isAbsolute, relative, resolve, dirname, join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { looksSensitive } from "./auto-approve.ts";
import type { ProviderToolDefinition } from "./contracts.ts";

export interface HarborTool extends ProviderToolDefinition {
  /** App-authored effect. Never inferred from model output or an MCP annotation. */
  effect: "read" | "local-write" | "command" | "external" | "schedule" | "computer";
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
const string = { type: "string" };
function schema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Symlinks and non-regular files are excluded, including during final open. */
export async function workspacePath(root: string, value: unknown, write = false): Promise<string> {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("Choose a file path");
  const base = await fs.realpath(root);
  const target = resolve(base, value);
  if (!inside(base, target)) throw new Error("This file is outside the agent's permitted folder");
  if (looksSensitive(target) || /(?:^|[\\/])(?:\.openmausbot|\.grokbot|\.codex|\.claude|\.ssh|\.aws|\.config)(?:[\\/]|$)/i.test(target.slice(base.length)) || /(?:^|[\\/])Library[\\/](?:Keychains|Application Support)/i.test(target.slice(base.length))) {
    throw new Error("Credential and application-private files are excluded from file tools");
  }
  const parts = relative(base, target).split(sep).filter(Boolean);
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are excluded from file tools");
      if (i < parts.length - 1 && !stat.isDirectory()) throw new Error("Parent is not a folder");
      if (i === parts.length - 1 && !stat.isFile() && !stat.isDirectory()) throw new Error("Only regular files and folders are supported");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !write || i !== parts.length - 1) throw error;
    }
  }
  return target;
}

export function fileTools(root: string): HarborTool[] {
  return [
    { name: "harbor_list_files", description: `List files in the permitted folder (${root}). Paths are relative to that folder.`, effect: "read", inputSchema: schema({ path: string }, []),
      execute: async (args, signal) => {
        signal.throwIfAborted();
        const path = await workspacePath(root, args.path || ".");
        return (await fs.readdir(path, { withFileTypes: true })).slice(0, 300).map(e => ({ name: e.name, kind: e.isSymbolicLink() ? "excluded-link" : e.isDirectory() ? "folder" : "file" }));
      } },
    { name: "harbor_read_file", description: "Read a UTF-8 text file from the permitted folder. Use this to retrieve saved notes between tasks.", effect: "read", inputSchema: schema({ path: string }, ["path"]),
      execute: async (args, signal) => {
        signal.throwIfAborted();
        const path = await workspacePath(root, args.path);
        const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > 256_000) throw new Error("Choose a text file smaller than 256 KB");
          signal.throwIfAborted();
          return { path, text: await file.readFile("utf8") };
        } finally { await file.close(); }
      } },
    { name: "harbor_write_file", description: "Save a UTF-8 text file in the permitted folder. Existing files require overwrite=true and a recovery copy is kept. The parent folder must already exist.", effect: "local-write", inputSchema: schema({ path: string, text: { type: "string", maxLength: 200_000 }, overwrite: { type: "boolean" } }, ["path", "text"]),
      execute: async (args, signal) => {
        signal.throwIfAborted();
        const path = await workspacePath(root, args.path, true);
        const previous = await fs.lstat(path).catch(e => { if(e.code !== "ENOENT") throw e; return null; });
        if (previous) {
          if (!previous.isFile() || args.overwrite !== true) throw new Error("File exists; explicitly request overwrite or choose a new name");
          if (previous.size > 256_000) throw new Error("Existing file exceeds the recovery copy limit");
          await fs.copyFile(path, `${path}.backup-${randomUUID()}`, constants.COPYFILE_EXCL);
        }
        signal.throwIfAborted();
        const temp = join(dirname(path), `.harbor-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temp, String(args.text), { flag: "wx", mode: 0o600 });
          await workspacePath(root, args.path, true);
          signal.throwIfAborted();
          if (previous) await fs.rename(temp, path);
          else { await fs.link(temp, path); await fs.unlink(temp); }
        } finally { await fs.unlink(temp).catch(() => {}); }
        return { saved: true, path, bytes: Buffer.byteLength(String(args.text)), recoveryCopy: Boolean(previous) };
      } },
    { name: "harbor_search_notes", description: "Search Markdown and text notes in the permitted folder, including subfolders. Returns matching paths and short excerpts; read a matching file for full context.", effect: "read", inputSchema: schema({ query: {type:"string",minLength:2,maxLength:200} }, ["query"]),
      execute: async(args,signal)=>{
        const matches: Array<{path:string;excerpt:string}>=[];let scanned=0,bytes=0;
        const query=String(args.query).toLowerCase();const base=await fs.realpath(root);
        const walk=async(dir:string,depth:number):Promise<void>=>{
          if(depth>8||scanned>=1500||matches.length>=30||bytes>16_000_000)return;
          signal.throwIfAborted();
          const entries=await fs.readdir(dir,{withFileTypes:true});
          for(const entry of entries){
            if(entry.name.startsWith(".")||entry.isSymbolicLink()||scanned>=1500||matches.length>=30||bytes>16_000_000)continue;
            const path=join(dir,entry.name);
            if(entry.isDirectory()){if(!["node_modules","Library"].includes(entry.name))await walk(path,depth+1);continue;}
            if(!entry.isFile()||!/[.](md|txt)$/i.test(entry.name))continue;
            scanned++;const stat=await fs.stat(path);if(stat.size>256_000)continue;bytes+=stat.size;
            let text:string;
            try{const value=await fileTools(root)[1].execute({path:relative(base,path)},signal) as {text:string};text=value.text;}catch{continue;}
            const index=text.toLowerCase().indexOf(query);
            if(index>=0)matches.push({path:relative(base,path),excerpt:text.slice(Math.max(0,index-100),index+250)});
          }
        };
        await walk(base,0);return {matches,scanned,limited:scanned>=1500||matches.length>=30||bytes>16_000_000};
      } },
  ];
}
