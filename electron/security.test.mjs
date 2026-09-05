import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const { allowedNavigation, trustedFrame, createIpcGuard } = createRequire(import.meta.url)("./security.cjs");
const origin = "http://127.0.0.1:8799";

describe("desktop privilege boundary", () => {
  it("rejects foreign ports, misleading hosts, credentials and non-web schemes", () => {
    for (const url of ['http://127.0.0.1:8800', 'http://127.0.0.1.evil.test:8799', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user@127.0.0.1:8799']) expect(allowedNavigation(url, origin)).toBe(false);
    expect(allowedNavigation(origin + '/settings', origin)).toBe(true);
  });
  it("rejects a same-origin subframe and a navigated main frame", () => {
    const main = { url: origin };
    expect(trustedFrame({ url: origin }, main, origin)).toBe(false);
    expect(trustedFrame(main, main, origin)).toBe(true);
    main.url = 'https://example.com';
    expect(trustedFrame(main, main, origin)).toBe(false);
  });
  it("checks ownership and frame before calling a privileged handler", () => {
    let handler; let calls = 0;
    const mainFrame = { url: origin }, sender = { mainFrame };
    const register = createIpcGuard({ handle(_name, callback) { handler = callback; } }, () => origin, (value) => value === sender);
    register('workspace:session', () => { calls++; return 'test secret'; });
    expect(() => handler({ sender: { mainFrame }, senderFrame: mainFrame })).toThrow();
    expect(() => handler({ sender, senderFrame: { url: origin } })).toThrow();
    expect(calls).toBe(0);
    expect(handler({ sender, senderFrame: mainFrame })).toBe('test secret');
  });
});
