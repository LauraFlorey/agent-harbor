# OpenMausBot upstream: last few weeks

Status: snapshot of [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) as of 2026-09-14. Agent Harbor last imported that repo on **2026-08-16** at commit `d579795` (**OpenMausBot 0.1.21**). Upstream is now **0.1.78** (released 2026-09-13). This is a delta note, not a merge plan.

Harbor should not blind-merge this. Upstream changed license (Apache-2.0 + an `enterprise/` folder), grew Android/iOS/hosted-fleet surfaces, and ships much faster than Harbor’s private control-plane pace. The useful part is what they learned about **computers and stalls**.

## Scale of the gap

| | Harbor checkout | OpenMausBot `main` |
|---|---|---|
| Version | `0.1.21` (`package.json`) | `0.1.78` |
| Last shared commit | `d579795` (2026-08-16) | 50+ patch releases since |
| Cadence | Friends-and-family / public-source prep | Roughly a release a day in early–mid September |
| License at sync | MIT (preserved in Harbor) | Apache-2.0; `enterprise/` is source-available, not Apache |

Releases: https://github.com/milind-soni/OpenMausBot/releases

---

## Computers (cloud, local, sharing)

Upstream is still the same three destinations Harbor inherited (cloud Box, Local VM, this computer), but they have been extending **who may share which machine** and **Windows host control**.

| Change | When | Why it matters for Harbor |
|---|---|---|
| **Windows CUA / local control** ([#1160](https://github.com/milind-soni/OpenMausBot/pull/1160), 0.1.78) | 13 Sep | Harbor’s README still says host control is not a Windows beta target. Upstream packaged the driver and enabled it. |
| **Shared Box computers on a team canvas** ([#1159](https://github.com/milind-soni/OpenMausBot/pull/1159), 0.1.77) | 13 Sep | Multiple bots on one cloud desktop. Harbor rooms do not share a Box that way. |
| **Hosted workspace switcher + opt-in computer sharing** ([#1145](https://github.com/milind-soni/OpenMausBot/pull/1145)), then **default-off feature gate** ([#1165](https://github.com/milind-soni/OpenMausBot/pull/1165)) and **shared-folder holes closed** ([#1162](https://github.com/milind-soni/OpenMausBot/pull/1162)) | 13 Sep | They shipped sharing, then immediately had to fail-closed. Harbor’s “destination is per bot, sharing is not a product” looks conservative and correct. |
| **Full Access actually hands-off** ([#1170](https://github.com/milind-soni/OpenMausBot/pull/1170)) | 13 Sep | Same class of bug as Harbor’s over-broad consequential gate: a mode that still interrupted the user. |
| **Off means no browser; connected apps per bot** ([#1129](https://github.com/milind-soni/OpenMausBot/pull/1129)) | 12 Sep | Destination `off` was leaking browser. Harbor already treats off as fail-closed; worth confirming still true after any future sync. |
| **Recover VPS previews + compress remote frames** ([#1081](https://github.com/milind-soni/OpenMausBot/pull/1081), 0.1.73); earlier **restore cloud previews** ([#800](https://github.com/milind-soni/OpenMausBot/pull/800)) | 5–11 Sep | Live preview of the cloud computer was dropping; they added recovery and compression. Harbor’s Box preview path (`server/box.ts`, computer panel) has the same failure mode. |
| **Stabilize browser control / stop helper focus-stealing** ([#1077](https://github.com/milind-soni/OpenMausBot/pull/1077)) | 10 Sep | GUI automation fighting the user. Directly relevant to Harbor Local VM clicks. |
| **Connect each speaker’s Local VM in group/Goal turns** ([#855](https://github.com/milind-soni/OpenMausBot/pull/855)) | 6 Sep | Rooms were sharing or missing VMs. Harbor rooms + exclusive Local VM lease is a known tension (`server/local-vm-lease.ts`). |
| **Ubuntu Xorg opt-in host control; Wayland still disabled** (README, issue [#345](https://github.com/milind-soni/OpenMausBot/issues/345)) | ongoing | Harbor still refuses Linux CUA in `server/local-computer.ts`. Upstream certified a narrower Xorg path. |

They also added **Windows shared-terminal / PowerShell discovery timeouts** ([#1169](https://github.com/milind-soni/OpenMausBot/pull/1169)) — a hung `Get-Command` look-up stalled native commands. Same family as “the computer looks busy but nothing is happening.”

---

## Stalls they hit (and how they handled them)

This is the closest analogue to Harbor’s “Local VM lease ended before the turn completed” and silent hangs.

| Failure | Fix | Harbor analogue |
|---|---|---|
| OpenAI-compatible streams died on a **hard absolute timeout** even while tokens were still arriving | **Renewable idle timeout** ([#1083](https://github.com/milind-soni/OpenMausBot/pull/1083)) | Harbor Sprint C: renew the VM lease on turn *progress*, not wall-clock alone (`server/local-vm-tool-turn.ts`). Same idea, different object. |
| A **resume never answered**; the thread looked alive | Recover that thread ([#1038](https://github.com/milind-soni/OpenMausBot/pull/1038), 0.1.71) | Harbor interrupt/resume is weaker; a wedged resumeCursor is still a risk in `server/store.ts`. |
| Turn released **before the CLI actually died** | Verify shutdown before releasing ([#1093](https://github.com/milind-soni/OpenMausBot/pull/1093), 0.1.74) | Harbor kill-tree / lease release races (`server/procs.ts`, `server/local-vm-lease.ts`). |
| **Driver startup blocked** the UI; stream buffers stalled | Don’t block startup; bound buffers ([#1095](https://github.com/milind-soni/OpenMausBot/pull/1095), 0.1.74) | Electron + harness boot; Harbor already probes health before trusting the port (`electron/main.mjs`). |
| Embedded server **crashed and stayed dead** | Recover/restart the child ([#1092](https://github.com/milind-soni/OpenMausBot/pull/1092), 0.1.74) | Harbor packaged `utilityProcess`; crash recovery is thinner. |
| ACP catalog probe **hung** | 15s deadline ([#1119](https://github.com/milind-soni/OpenMausBot/pull/1119)) | Harbor ACP model fetch can stall instance refresh (`server/drivers/acp/`). |
| **Stuck approvals** after deleting a thread | Clear them ([#1114](https://github.com/milind-soni/OpenMausBot/pull/1114), 0.1.75) | Harbor approval cards live on messages; deleting a bot/thread should not leave a live ask. |
| Claude “approve for me” **never started**, so the user waited | Self-answer when the reviewer never appears ([#1088](https://github.com/milind-soni/OpenMausBot/pull/1088), 0.1.74) | Harbor peer-approval / Auto can wait forever without a timeout UI. |
| Codex **helper finishing killed the parent run** | Don’t treat helper completion as parent end ([#1069](https://github.com/milind-soni/OpenMausBot/pull/1069), 0.1.73) | Harbor Codex driver session lifecycle (`server/drivers/codex.ts`). |
| Loading **the whole thread** from disk/SQL | Newest-N pages ([#1100](https://github.com/milind-soni/OpenMausBot/pull/1100)) | Harbor `GET /api/bots` still returns entire transcripts (`server/index.ts` comment). That will feel like a stall as rooms grow. |

They also added an **optional Advanced run limit** on routines (README): no timeout unless chosen, skip the next occurrence if the previous is still running. That is how they stop scheduled work from queueing forever without killing healthy long jobs.

---

## Product they added that Harbor probably should not copy

These are real improvements *for their Grok-Bot-clone / hosted product*. They fight Harbor’s “one owner, local control plane” vision (`VISION.md`).

- **Android 1.0–1.2** (1–4 Sep) and a threads preview APK (12 Sep); **iOS** thread nav + Walkie hold-to-talk (11–13 Sep).
- **`npx openmausbot`**, VPS/Tailscale/tunnel self-host, phone pairing (README).
- **Fleet / hosted workspaces / People / monthly spend / sell prices** (0.1.72): many client workspaces on one server.
- **Computer sharing across people** — shipped, then gated off after folder-identity bugs.
- **i18n** (Traditional Chinese, Ukrainian) and a **Daylight** light theme.
- **Apache-2.0 + `enterprise/`** (README / `LICENSING.md`). Harbor remains MIT with OpenMausBot attribution; a sync would be a licensing event, not just a merge.
- **SQLite FTS message DB** (they moved off “load every JSON transcript”). Harbor still uses `messages-<threadId>.json`.

---

## Product they added that *does* overlap Harbor’s roadmap

Worth reading the PRs; still implement in Harbor’s architecture.

| Upstream | Harbor status |
|---|---|
| **Settings → full workspace backup and restore** ([#1072](https://github.com/milind-soni/OpenMausBot/pull/1072), 0.1.72) | Sprint 10 / comparison P0.2. They shipped the owner recovery Harbor still lacks. |
| **Usage ledger + channel spend cap** ([#1052](https://github.com/milind-soni/OpenMausBot/pull/1052), [#1135](https://github.com/milind-soni/OpenMausBot/pull/1135)) | Harbor has cost on `turn.completed` but no ledger UI (comparison P1.4). |
| **Per-bot MCP + guided setup** ([#956](https://github.com/milind-soni/OpenMausBot/pull/956)) | Harbor MCP is mostly an internal computer/agent bridge (comparison P1.7). |
| **Thread-aware bots / #thread chips** (0.1.70) | Harbor has tasks (separate threads per bot) but not this navigation model. |
| **Skills as saved runs** (0.1.71–0.1.72) | Out of Harbor scope unless Jinx/instruction-stack sprint says so. |
| **Channels / BotMRR markdown team import** (README) | Harbor already has team manifests (`server/team-manifest.ts`); their Markdown+YAML playbooks are a richer cousin. |
| **Stdio MCP control plane for Cursor/Claude Desktop** (README) | Harbor has `/api/internal` for peer agents; exposing a bounded MCP of the *harbor itself* is a different product. |

---

## Practical takeaway

Upstream spent the last four weeks becoming a **multi-surface, multi-user, daily-release** app (desktop + Android + iOS + `npx` + hosted fleet). Harbor spent them on **approval integrity and Local VM leases**.

The overlap that is actually useful, without taking their product:

1. Heartbeat/idle timeouts on *streams and tools*, not only on the VM lease ([#1083](https://github.com/milind-soni/OpenMausBot/pull/1083), [#1093](https://github.com/milind-soni/OpenMausBot/pull/1093)).
2. Recover wedged resumes and crashed harness children ([#1038](https://github.com/milind-soni/OpenMausBot/pull/1038), [#1092](https://github.com/milind-soni/OpenMausBot/pull/1092)).
3. Owner backup/restore ([#1072](https://github.com/milind-soni/OpenMausBot/pull/1072)).
4. Don’t share computers until the folder/identity gates are boringly strict ([#1162](https://github.com/milind-soni/OpenMausBot/pull/1162), [#1165](https://github.com/milind-soni/OpenMausBot/pull/1165)).
5. Page transcripts instead of returning every message on `/api/bots`.

A full upstream sync is a separate, explicit decision: license change, enterprise tree, mobile apps, and hosted multi-tenancy would all land in the same merge.
