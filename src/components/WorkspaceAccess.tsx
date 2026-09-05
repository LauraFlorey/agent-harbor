import { useEffect, useState, type ReactNode } from "react";
import { setSessionToken, workspaceFetch } from "@/lib/api-auth";

export function WorkspaceAccess({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(window.ogb?.getSessionToken));
  const connect = async (token: string) => {
    setSessionToken(token.trim());
    const response = await workspaceFetch("/api/config");
    if (!response.ok) throw new Error("This access code has expired. Get a new code from your running workspace.");
  };
  useEffect(() => {
    let active = true;
    if (window.ogb?.getSessionToken) {
      void window.ogb.getSessionToken().then(connect).then(() => { if (active) setReady(true); })
        .catch(() => { if (active) setError("Could not connect to the workspace. Check that its server is running, then retry."); })
        .finally(() => { if (active) setBusy(false); });
    }
    return () => { active = false; };
  }, []);
  if (ready) return children;
  return <main className="flex min-h-screen items-center justify-center bg-app text-ink">
    <form className="w-full max-w-md space-y-4 rounded-xl bg-raised p-8" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError("");
      void (window.ogb?.getSessionToken ? window.ogb.getSessionToken() : Promise.resolve(code)).then(connect)
        .then(() => { setCode(""); setReady(true); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not connect."))
        .finally(() => setBusy(false));
    }}>
      <h1 className="text-xl font-semibold">Connect to Agent Harbor</h1>
      {!window.ogb?.getSessionToken && <>
        <p>Paste the access code from your running workspace. The code stays in this tab until you close or reload it.</p>
        <label className="block">Workspace access code<input type="password" autoComplete="off" required value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 w-full rounded border border-hairline bg-inset p-2" /></label>
        <p className="text-sm text-ink-secondary">Run <code>pnpm dev:access</code> in your local project to display the code.</p>
      </>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button disabled={busy} className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50">{busy ? "Connecting…" : "Connect"}</button>
    </form>
  </main>;
}
