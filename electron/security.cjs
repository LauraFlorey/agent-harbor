"use strict";
const fs = require("node:fs");

function allowedNavigation(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && url.protocol === "http:" && !url.username && !url.password;
  } catch { return false; }
}

function trustedFrame(frame, mainFrame, origin) {
  return Boolean(frame && frame === mainFrame && allowedNavigation(frame.url, origin));
}

function createIpcGuard(ipcMain, getOrigin, isOwned) {
  return (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    if (!isOwned(event.sender) || !trustedFrame(event.senderFrame, event.sender.mainFrame, getOrigin())) {
      throw new Error("Untrusted workspace message");
    }
    return handler(event, ...args);
  });
}

function readSessionToken(file, port) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077))) {
    throw new Error("Unsafe workspace session file");
  }
  const session = JSON.parse(fs.readFileSync(file, "utf8"));
  if (session.port !== port || !Number.isSafeInteger(session.pid) || !/^[a-f0-9]{64}$/.test(session.token)) {
    throw new Error("Invalid workspace session");
  }
  process.kill(session.pid, 0);
  return session.token;
}

module.exports = { allowedNavigation, trustedFrame, createIpcGuard, readSessionToken };
