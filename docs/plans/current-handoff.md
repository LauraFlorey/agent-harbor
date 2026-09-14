# Current handoff

Updated September 7, 2026 after the local actions, Jinx, profile and attachment
work, followed by documentation reconciliation.

## Repository and runtime state

| Item | Observed state |
|---|---|
| Repository | `/Users/lauraflorey/projects/agent-harbor` |
| Branch | `codex/personal-action-capabilities` |
| HEAD | `4403d90ef5ac080e47bf1781e7077f00d1be00f8` |
| Package version | `0.1.21` |
| Working tree | Substantial modified and untracked implementation/documentation files; recent work is uncommitted |
| Runtime | Unified source development app on Laura's Mac; API, UI and webhook health endpoints responded successfully during this documentation refresh |
| Remote | Branch has an upstream tracking configuration; remote contents and repository visibility were not freshly checked |
| Promotion | No commit, push, merge, new package, installer promotion or recovery test performed for the recent work |
| Product scope | Private personal use; no public release planned |

Preserve the existing worktree, including the owner `.agents/` directory. Do not
reset it to HEAD or treat HEAD as containing the September implementation.
The documentation refresh changes documentation only and does not restart the app.

## Current capabilities

- OpenRouter and Jinx direct chats use Harbor's bounded action loop for scoped
  notes, approved commands, connected apps where available, schedules and peers.
- Host desktop actions use the selected **This computer** destination and the
  installed CuaDriver. Standing attended permission is owner consent to desktop
  interactions, not a consequence classifier. The isolated Local VM remains a
  separate route with its own controls and unfinished acceptance.
- A loopback local-model connection supports notes, schedules and attachments.
  Harbor excludes cloud search/apps/delegation, commands and desktop from that
  mode. Direct local chat disables cloud speech in the UI; group voice and the
  generic TTS endpoint have a privacy gap noted below. Text-only models can read extraction/transcripts; local vision
  requires explicit selected-model capability metadata.
- Jinx connects over SSH to the existing Mini service and memory pipeline.
  Current-context retrieval, cross-task recall, archive receipts, teammate
  discovery and an actual teammate reply have been exercised.
- Profile images are local; emoji messages and user-added reactions are available.
- Attachments support DOC/DOCX/RTF, XLS/XLSX/CSV, PDF, text, images, audio and video.
  Speech is transcribed locally. Video understanding uses selected frames and
  speech; visual content requires a compatible model.

API-model rooms receive attachment tools, not the full direct-chat action set.
Jinx sees teammate metadata and busy/idle status, not automatic access to all
conversations. Private local agents reject cloud delegation.

## Personal setup observed during implementation

Jinx remains on the Mac Mini behind SSH alias `jinx-mini`; her bridge is inside
the existing process and bound to Mini loopback port 8768. Credentials and the
bridge token remain there. Her cloud model and fallback were not replaced.
Open Brain and other pre-existing remote archives keep their existing locations.

The current Mac has an Obsidian vault under `~/Agent Harbor/`, with separate
`Private notes` and `Shared work` folders. Harbor Local uses local inference;
Harbor Assistant uses OpenRouter. Existing Jinx vaults were not relocated.
LM Studio's installed GPT-OSS model was verified for text/transcripts and Qwen
3.5 for image inspection; the default Harbor Local model was left unchanged.
These are dated setup observations, not promises that services remain reachable.

The Jinx integration's original-code backup is on the Mini under
`~/.jinx-harbor-backups/20260907-162357/`. It is not a complete memory backup.
See [Jinx deployment and memory](../jinx-connection.md) before changing that system.

## Verification evidence from September 7

| Check | Result and scope |
|---|---|
| Attachment-era full suite | 85 files passed; 752 tests passed, 8 skipped; 12 updater tests passed |
| Follow-up focused checks | 4 files, 18 tests passed after attachment follow-ups |
| Final local-model compatibility checks | 2 files, 53 tests passed after the initial-assistant-message replay fix |
| Final production build | Passed, including TypeScript checks; bundle-size warning remains |
| Electron syntax and diff integrity | Passed during implementation |
| Live Jinx attachment review | Correct document text, spreadsheet formula/cached total, PDF text and scanned page, image, audio speech and video frame/speech from synthetic fixtures |
| Live local-model review | GPT-OSS read spreadsheet and speech transcript; Qwen inspected an image through the attachment tool |
| Attachment mechanics | Downloaded original matched source bytes; legacy DOC extraction passed; temporary validation agents/files were removed |
| Profile UI | Choose picture, save/reload and return to mascot exercised |
| Current health | API, interface and dedicated webhook receiver returned HTTP 200 during this documentation refresh |

The full suite preceded the final small compatibility changes; the later focused
checks and build covered those changes. Do not call the 752-test result a full
suite rerun of the final exact worktree. No new code tests were needed for the
documentation-only refresh.

Temporary implementation evidence, if still present on this Mac:

- `/tmp/agent-harbor-attachments-all-tests.log`
- `/tmp/agent-harbor-attachments-followup-tests.log`
- `/tmp/agent-harbor-local-template-tests.log`
- `/tmp/agent-harbor-attachments-build.log`
- `/tmp/agent-harbor-attachments-electron-check.log`
- `/tmp/agent-harbor-attachments-runtime.log`

These temporary logs are not a durable backup or committed acceptance artifact.

## Remaining gaps and next work

Laura is trying the app before deciding on Grokbot data migration. No Grokbot
records were imported or deleted. Remote Harbor access over Tailscale is also
future work. The app API remains loopback-only and unauthenticated.

The complete experimental Local VM browser-action and recovery sequence remains
unfinished. Lease heartbeat and approval calibration are implemented, but their
live resolution of the earlier lease-expiry failure has not been established.
Do not broaden its acceptance claim based on host desktop or media results.

Source inspection during the documentation refresh found that group calls do
not apply the direct-chat local-model speech guard, and the generic TTS endpoint
does not bind requests to a bot's privacy mode. With ElevenLabs configured, these
paths can send supplied text to cloud speech. Use direct text for private local
work until the UI and server boundaries are completed. No runtime changes or
cloud speech requests were made in this review. See [voice](../voice-mode.md).

Media tools and the speech model are installed on this Mac. New parser/native
runtime dependencies and media tooling have not been accepted in a fresh-machine
installer. Other-platform validation of these additions, backup restoration,
rollback and personal installation promotion remain open.

Next priorities are real-use feedback, then an explicit migration decision and
a recoverable personal checkpoint. Consult [Roadmap](../../ROADMAP.md),
[installation and recovery](../deployment.md), and the scoped
[Local VM acceptance plan](openrouter-local-vm-tool-loop.md).
