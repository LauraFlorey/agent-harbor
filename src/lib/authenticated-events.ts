import { workspaceFetch } from "./api-auth";

/** EventSource cannot send Authorization headers. Keep reconnect/replay semantics
 * over fetch, without leaking the session credential into query strings. */
export class AuthenticatedEvents {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  private controller = new AbortController();
  private lastId = "";

  constructor(private readonly path: string) { void this.run(); }
  close(): void { this.controller.abort(); }

  private async run(): Promise<void> {
    const signal = this.controller.signal;
    while (!signal.aborted) {
      try {
        const response = await workspaceFetch(this.path, {
          headers: { accept: "text/event-stream", ...(this.lastId ? { "last-event-id": this.lastId } : {}) }, signal,
        });
        if (!response.ok || !response.body) throw new Error("Event connection unavailable");
        this.onopen?.();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "", data: string[] = [], id: string | undefined, eventBytes = 0;
        try {
          while (!signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            if (buffer.length > 16 * 1024 * 1024) throw new Error("Event exceeds limit");
            let end: number;
            while ((end = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, end).replace(/\r$/, "");
              buffer = buffer.slice(end + 1);
              eventBytes += line.length;
              if (eventBytes > 16 * 1024 * 1024) throw new Error("Event exceeds limit");
              if (!line) {
                if (data.length) {
                  if (id !== undefined) this.lastId = id;
                  this.onmessage?.({ data: data.join("\n") });
                }
                data = []; id = undefined; eventBytes = 0;
              } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
              else if (line.startsWith("id:") && !line.includes("\0")) id = line.slice(3).replace(/^ /, "");
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch { /* reconnect below, unless closed */ }
      if (signal.aborted) return;
      this.onerror?.();
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, 1500);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
