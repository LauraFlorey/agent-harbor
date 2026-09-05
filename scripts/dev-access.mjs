// Explicit owner request only; startup never logs this credential.
import { readFileSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const port = Number(process.env.OMB_PORT ?? 8799);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid OMB_PORT");
const file = join(process.env.OMB_DATA_DIR ?? join(homedir(), ".openmausbot"), `session-${port}.json`);
const stat = lstatSync(file);
if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error("Unsafe session file");
const session = JSON.parse(readFileSync(file, "utf8"));
process.kill(session.pid, 0);
if (session.port !== port || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error("Invalid session file");
console.log("Private workspace access code (valid until the server restarts):\n" + session.token);
