import { afterEach, expect, it, vi } from "vitest";
import { setSessionToken, workspaceFetch } from "./api-auth";
afterEach(() => vi.unstubAllGlobals());
it("uses a header and never forwards owner credentials to arbitrary destinations", async () => {
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  setSessionToken('a'.repeat(64));
  for (const path of ['https://example.com/api/', '//example.com/api/', '/api/../outside', '/api/\\example.com']) await expect(workspaceFetch(path)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await workspaceFetch('/api/bots', { method: 'POST' });
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/bots');
  expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${'a'.repeat(64)}`);
  expect(options.redirect).toBe('error');
});
