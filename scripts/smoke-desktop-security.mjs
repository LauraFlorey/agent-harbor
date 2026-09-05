// Run with Electron after building. Uses a hidden window, disposable data,
// and an unavailable provider. It never starts CUA or uses personal settings.
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { createIpcGuard, allowedNavigation, readSessionToken } = createRequire(import.meta.url)("../electron/security.cjs");
const directory = mkdtempSync(join(tmpdir(), "ah-desktop-security-"));
app.setPath("userData", join(directory, "profile"));
const data = join(directory, "data");
mkdirSync(data);
writeFileSync(join(data, "config.json"), JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }));
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
let child, window;
let output = "";
async function main() {
  try {
    await app.whenReady();
    const port = await freePort(), webhookPort = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    child = utilityProcess.fork(join(root, "dist-server/index.js"), [], {
      env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), OMB_DATA_DIR: data, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhookPort), OMB_STATIC_DIR: join(root, "dist"), OMB_SECRET_STORE: "file", OMB_SKIP_LOCAL_VM_STARTUP_PROBE: "1" }, stdio: "pipe",
    });
    child.stdout.on("data", (part) => { output += part; }); child.stderr.on("data", (part) => { output += part; });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch { /* booting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Isolated server did not start: " + output);
    window = new BrowserWindow({ show: false, webPreferences: { preload: join(root, "electron/preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    const register = createIpcGuard(ipcMain, () => origin, (sender) => sender === window.webContents);
    register("workspace:session", () => readSessionToken(join(data, `session-${port}.json`), port));
    register("desktop:capabilities", () => ({ host: { platform: process.platform, label: "Test", session: "unknown", packaged: false }, windowChrome: "native", screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false }, localComputer: { available: false, support: "unsupported" } }));
    window.webContents.on("will-navigate", (event, url) => { if (!allowedNavigation(url, origin)) event.preventDefault(); });
    await window.loadURL(origin);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const token = await window.ogb.getSessionToken();
      const owner = await fetch('/api/bots', {headers: {authorization: 'Bearer ' + token}});
      const stranger = await fetch('/api/bots');
      const stream = await fetch('/api/events', {headers: {authorization: 'Bearer ' + token}});
      const reader = stream.body.getReader(); const first = await reader.read(); await reader.cancel();
      for (let i=0; i<80 && !document.body.textContent.includes('Welcome to Agent Harbor'); i++) await new Promise(r=>setTimeout(r,100));
      return { owner: owner.status, stranger: stranger.status, stream: stream.status, receivedHello: new TextDecoder().decode(first.value).includes('hello'), appRendered: document.body.textContent.includes('Welcome to Agent Harbor'), hasUpdater: Boolean(window.ogb.updater), tokenPersisted: Object.values(localStorage).some(value=>String(value).includes(token)) };
    })()`);
    if (result.owner !== 200 || result.stranger !== 401 || result.stream !== 200 || !result.receivedHello || !result.appRendered || result.hasUpdater || result.tokenPersisted) throw new Error(JSON.stringify(result));
    await window.webContents.executeJavaScript("location.href = 'data:text/html,untrusted'; undefined");
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!allowedNavigation(window.webContents.getURL(), origin)) throw new Error('Foreign navigation was allowed');
    console.log('DESKTOP_SECURITY_OK ' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    window?.destroy();
    if (child) {
      const exited = once(child, "exit"); child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    rmSync(directory, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }

}
void main();
