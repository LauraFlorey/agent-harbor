// Durable, atomic file replace: write to a sibling temp file, fsync it, then
// rename over the target. rename(2) is atomic on the same filesystem, so a
// crash or power loss mid-write can never leave a truncated file behind — a
// reader always sees either the complete old contents or the complete new
// ones. Without this, an interrupted writeFileSync produces half-written JSON
// that fails to parse on next boot and is silently treated as empty state.
import { randomUUID } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
export function writeFileAtomic(path, data, options = {}) {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let fd = null;
    try {
        // Apply sensitive-file permissions to the temporary inode itself. The
        // final rename preserves them and never leaves a broader-permission
        // config file visible between the write and a later chmod.
        const mode = options.mode ?? 0o600;
        fd = openSync(tmp, "wx", mode);
        // The creation mask may be stricter or looser than the app's contract.
        // Set the exact requested mode on the open inode before it becomes visible.
        fchmodSync(fd, mode);
        writeFileSync(fd, data);
        fsyncSync(fd);
        closeSync(fd);
        fd = null;
        renameSync(tmp, path);
    }
    catch (e) {
        if (fd !== null) {
            try {
                closeSync(fd);
            }
            catch {
                /* best-effort cleanup */
            }
        }
        try {
            unlinkSync(tmp);
        }
        catch {
            /* best-effort cleanup */
        }
        throw e;
    }
}
