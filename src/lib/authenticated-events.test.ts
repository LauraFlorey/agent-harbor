import { afterEach, expect, it, vi } from "vitest";
import { setSessionToken } from "./api-auth";
import { AuthenticatedEvents } from "./authenticated-events";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("reassembles split frames and resumes with a header rather than a credential URL", async () => {
  vi.useFakeTimers();
  setSessionToken('b'.repeat(64));
  const encoder = new TextEncoder();
  const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    for (const part of ["id: cur", "sor-1\r\ndata: hello\r\n", "data: world\r\n\r\n"]) controller.enqueue(encoder.encode(part));
    controller.close();
  } })));
  vi.stubGlobal('fetch', fetch);
  const stream = new AuthenticatedEvents('/api/events');
  const messages: string[] = [];
  stream.onmessage = (event) => messages.push(event.data);
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(messages).toEqual(['hello\nworld']);
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const [url, options] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/events');
    expect(new Headers(options.headers).get('last-event-id')).toBe('cursor-1');
    expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${'b'.repeat(64)}`);
  } finally { stream.close(); }
  expect(vi.getTimerCount()).toBe(0);
});
