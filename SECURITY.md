# Security boundaries

Current implementation notes, September 7, 2026. Target policy features are
separately described in [Architecture](ARCHITECTURE.md). This document does not
claim that every provider or UI action shares the same enforcement path.

## Reporting

Do not put credentials or exploit details in public issues. Use repository
private vulnerability reporting when enabled, or contact the owner privately.

## Local API and secrets

The harness binds to `127.0.0.1`, validates local request hosts/origins, and has
no user authentication. It trusts the local machine; it is not a multi-user
security boundary. Do not expose the app API to a LAN, public proxy or Tailscale
until a separate authenticated remote-access design is implemented.

The dedicated webhook receiver on port 8800 is a separate surface with secret
trigger endpoints. Proxying only that receiver does not provide remote app
access. See [deployment](docs/deployment.md).

Harbor-managed API credentials use macOS Keychain or the mode-0600
`~/.openmausbot/secrets.json` fallback on Windows/Linux. Configuration responses
expose configured flags, not stored values. Secrets must not enter provider
context, logs, command arguments or committed files. CLI providers and Jinx may
also use credentials held by their own systems.

Agent-facing subprocess helpers use environment filtering and explicit
credential injection where implemented. This is not a claim that every parser
worker or media helper is an isolated process or receives a filtered environment.

## Files, commands and action approvals

File tools resolve paths within the agent's permitted folder, reject symlinks
and excluded credential paths, bound reads/searches, and retain recovery copies
on explicit overwrites. This is a tool-level restriction. Native agents and
approved commands run with the local user's OS permissions; a working directory
is not a sandbox. The explicit command tool executes owner-approved commands;
other subprocess launchers must not interpolate untrusted text into shells.

The general API-model action loop supports these grants:

- Attended read and reversible local-write effects run directly.
- The scheduled-notes setting permits those effects for unattended runs.
- The attended desktop setting permits interaction with the selected host
  computer. It can include submitting forms or changing sites and does not
  classify every click for consequences. That setting alone grants no
  unattended desktop authority.
- Commands, app execution and new schedules require approval unless the exact
  tool and serialized arguments match a remembered **Always allow** grant.
  Remembered grants also apply to matching unattended actions.

Denial ends further tool execution in the current action turn. Stop cancels
pending approval and owned sessions. Defaults bound turns to 80 calls and 20
minutes, with a 10-minute approval wait. Native CLI/ACP engines have their own
provider permission behavior in addition to Harbor's integrations.

## Local inference and attachments

Local-model mode accepts literal loopback HTTP endpoints and rejects redirects.
Harbor omits cloud search, connected apps, commands, desktop and peer MCP from
those turns and provides no automatic cloud-model fallback. Direct local chat
speech controls are disabled in the UI. Group calls lack the same local-model
guard, and the generic TTS endpoint does not enforce per-bot privacy. Private
local work should use direct text conversations until this gap is closed; see
[voice](docs/voice-mode.md). It
rejects cloud-to-local delegation and mixed local/cloud rooms. Switching a local
agent to a cloud model shows a history-sharing notice. The local model server
must itself be configured for local computation.

Attachment originals, metadata and prepared content are private local files.
The attachment reader accepts only IDs referenced in user messages in the current
conversation's active branch. Native agents may also receive copies inside their
working directory; this is not protection from commands with wider OS access.
The local download API uses the app's loopback boundary, not a separate login.

Parsing has bounded worker memory/time and output sizes. It does not execute
document macros or spreadsheet formulas. Workers are not an OS security sandbox.
Audio transcription and image normalization happen locally; selected cloud
models receive extracted previews and requested content. Uploaded content remains
untrusted context. Removing a draft chip is not file deletion. Retention and
secure erasure are not yet a complete lifecycle feature. See [attachments](docs/attachments.md).

## Jinx

The Mini bridge requires a private token and listens only on Mini loopback.
Harbor reaches it through the configured SSH connection; the token and Jinx's
provider keys stay on the Mini. Jinx read tools and approved write tools retain
Harbor's action controls; destructive Jinx tools are not exported by the bridge.
Memory staging receipts do not prove promotion or complete local-only storage:
existing remote archives retain their own boundaries. See [Jinx](docs/jinx-connection.md).

## Experimental OpenRouter Local VM

This route is separate from general OpenRouter host/file/app actions. It requires
both default-off switches, the exact `openai/gpt-5.6-terra` model with current
capability metadata, a direct conversation, an explicit Local VM destination and
a ready isolated VM. It must not fall through to a host or cloud destination.

A task-scoped routine grant or eligible attended Auto mode permits routine VM
calls. Consequential calls require a fresh one-attempt decision. Prompts, model
responses, MCP tools and copied approval data do not grant authority. The turn
owns an exclusive lease and bounded execution/cleanup. Its tool set excludes
general local files, host desktop, connected apps and peers.

The global switch provides rollback for this route. The complete live browser,
interruption and recovery sequence remains unaccepted despite code coverage and
an earlier successful single tool call. Consult the [current handoff](docs/plans/current-handoff.md)
and [Local VM plan](docs/plans/openrouter-local-vm-tool-loop.md).
