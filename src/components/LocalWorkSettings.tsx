import { useState } from "react";
import { api, useStore, type Bot } from "@/state/store";

const input = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink";
export function LocalWorkSettings({bot}:{bot:Bot}) {
  const {state,dispatch}=useStore();
  const [folder,setFolder]=useState(bot.workspaceFolder??"");
  const [error,setError]=useState("");
  const local=state.instances.find(i=>i.instanceId===bot.modelSelection.instanceId)?.driverKind==="localModel";
  const jinx=state.instances.find(i=>i.instanceId===bot.modelSelection.instanceId)?.driverKind==="jinx";
  const save=async()=>{
    setError("");
    try{
      await api(`/api/bots/${bot.id}`,{method:"PATCH",body:JSON.stringify({workspaceFolder:folder})});
      dispatch({type:"updateBot",botId:bot.id,patch:{workspaceFolder:folder}});
    }catch(e){setError(e instanceof Error?e.message:"Could not save folder");}
  };
  return <div className="rounded-xl bg-card p-4 space-y-3">
    <div className="text-[15px] font-medium text-ink">Local work and notes</div>
    <p className="text-[13px] text-ink-secondary">{jinx?"Jinx runs on your Mac Mini with her existing model and memory system. Completed chats are saved and summarized there. Her cloud model receives the context needed to reply. This optional folder is for additional work on this Mac.":local?"This agent uses a model on your Mac. It has no automatic cloud fallback, connected cloud apps, or delegation to cloud models.":"History and notes are saved on your Mac. Messages and files the agent reads are sent to your selected model provider."}</p>
    <label className="block text-[13px] text-ink-secondary">Permitted folder (optional)
      <input aria-label="Permitted folder" className={`${input} mt-1`} value={folder} onChange={e=>setFolder(e.target.value)} placeholder="Full path to a folder or Obsidian vault" />
    </label>
    <p className="text-[12px] text-ink-secondary">Leave blank for this agent's private workspace. You can select a local Obsidian vault or subfolder. Reading notes retrieves their content; saving notes keeps recovery copies of overwritten files. A folder under iCloud may sync with Apple.</p>
    <button onClick={()=>void save()} className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink">Save folder</button>
    {error&&<p role="alert" className="text-danger text-[13px]">{error}</p>}
    {!local && <label className="flex gap-2 text-[13px] text-ink"><input type="checkbox" checked={!!bot.desktopAuto} onChange={e=>{const enabled=e.target.checked;if(enabled&&!window.confirm("Allow this agent to click, type and operate the selected desktop during tasks without asking for every step? These actions can submit forms or change websites. Commands and connected-app actions still ask separately."))return;dispatch({type:"updateBot",botId:bot.id,patch:{desktopAuto:enabled}});}} />Allow desktop actions during attended tasks</label>}
    <label className="flex gap-2 text-[13px] text-ink"><input type="checkbox" checked={!!bot.autoRun} onChange={e=>dispatch({type:"updateBot",botId:bot.id,patch:{autoRun:e.target.checked}})} />Allow scheduled tasks to read and save notes in this folder</label>
    <p className="text-[12px] text-ink-secondary">{local ? "Private local mode supports notes and schedules. Cloud voice, connected apps and computer control are unavailable in this mode." : "Commands and connected-app execution need approval or a remembered exact action. Desktop actions follow the setting above."} Agent Harbor must stay running for local schedules.</p>
  </div>;
}
export function LocalModelSettings(){
  const {state,dispatch,refreshInstances}=useStore();
  const [url,setUrl]=useState(state.config?.localModel?.url??"http://127.0.0.1:1234/v1");
  const [status,setStatus]=useState("");
  const save=async()=>{setStatus("Checking…");try{const config=await api("/api/config",{method:"PUT",body:JSON.stringify({localModel:{url}})});dispatch({type:"configStatus",config});await refreshInstances();setStatus("Saved. Choose Local model in an agent's model picker. If unavailable, load a model and start its local server.");}catch(e){setStatus(e instanceof Error?e.message:"Connection failed");}};
  return <div className="rounded-xl bg-card p-4 space-y-3"><div className="font-medium text-ink">Local model</div><p className="text-[13px] text-ink-secondary">Connect LM Studio or Ollama on this Mac. LM Studio normally uses port 1234; Ollama uses 11434. Local-model turns do not fall back to a cloud model.</p><input aria-label="Local model server address" value={url} onChange={e=>setUrl(e.target.value)} className={input}/><button onClick={()=>void save()} className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink">Save and check models</button>{status&&<p role="status" className="text-[12px] text-ink-secondary">{status}</p>}</div>;
}
