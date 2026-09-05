let sessionToken = "";

export function setSessionToken(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Enter a valid workspace access code.");
  sessionToken = value;
}

/** Memory only: never place the credential in URLs, cookies, or browser storage. */
export async function workspaceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/api/") || path.includes("\\") || new URL(path, "http://workspace.invalid").pathname !== path.split("?")[0]) {
    throw new Error("Workspace requests must use a local API path.");
  }
  if (!sessionToken) throw new Error("Connect to your workspace first.");
  const send = () => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${sessionToken}`);
    if (!["GET", "HEAD"].includes(init.method ?? "GET")) headers.set("content-type", "application/json");
    return fetch(path, { ...init, headers, redirect: "error" });
  };
  let response = await send();
  if (response.status === 401 && typeof window !== "undefined" && window.ogb?.getSessionToken) {
    await response.body?.cancel();
    setSessionToken(await window.ogb.getSessionToken());
    response = await send();
  }
  return response;
}
