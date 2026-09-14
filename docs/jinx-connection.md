# Jinx in Agent Harbor

Current behavior, September 7, 2026. The Mini bridge is installed in Laura's
existing Jinx process and has been exercised from the Harbor source app.

The optional `jinx` provider connects to the existing Jinx service on the user's
Mac Mini. Jinx's configured model, fallback, identity, context assembler, Reach
tools, memory files and summarizer remain there. The connection adds an interface
to that running service; it does not copy its memory into a Harbor profile.

Harbor and Discord have separate live transcripts. Each Harbor completion loads
the current Jinx context and up to three recent Harbor summaries awaiting Jinx's
normal promotion pipeline. Completed exchanges are saved as new raw records and
summarized through Jinx's existing staging process. Promotion into warm memory
still follows Jinx's existing schedule. Original memories are not migrated or
overwritten by the connector.

The Chief of Staff profile uses Harbor's real teammate tools. Memory search and
other registered read tools run directly in attended tasks. Remote write tools
require Harbor's action approval; destructive Jinx tools are not exported.
Discord command syntax is not supported by this interface.

## Chief of Staff and files

The coordination tools have distinct behavior:

| Tool | What Jinx can learn or do |
|---|---|
| `list_bots` | Teammate names/IDs, descriptions, roles, models and busy/idle status |
| `ask_bot` | Ask an idle teammate and receive its actual reply; a busy teammate returns that status promptly |
| `delegate_bot` | Queue separate work after the caller's turn; results appear in Harbor, not as an inline reply to the calling turn |

This is not automatic access to every teammate's current task or full chat, and
it is not continuous background monitoring. Private local agents reject cloud
requests and delegation. Coordination remains subject to each route's controls.

Jinx can read files attached to the current Harbor conversation through the
attachment reader, including document text, spreadsheet cells, scanned pages,
images, speech transcripts and selected video frames. Originals remain on the
Harbor host; previews and requested content travel through SSH to Jinx and her
selected model. Her cloud model must support vision for visual inputs.
See [attachments](attachments.md) for limits and [using Harbor](using-agent-harbor.md)
for emoji and profile pictures.

## Connection

The Mini hosts an authenticated HTTP bridge bound only to `127.0.0.1:8768` within
the existing Jinx process. Each request travels through the user's existing SSH
configuration. The bridge token and model-provider credentials stay on the Mini.
There is no public listener or new cloud service.

Configure `jinx.host` as an existing SSH alias and `jinx.root` as Jinx's absolute
checkout path in Harbor's local configuration. These settings register the
provider only for an explicitly configured installation. The Mini and SSH must be
reachable; an offline Mini reports unavailable rather than substituting another
model or a disconnected Jinx profile.

Jinx still uses its configured cloud model. Existing optional services, including
Open Brain, retain their own storage locations and credentials. Connecting Harbor
does not convert remote archives or cloud inference into fully local processing.

## Deployment and recovery

`integrations/jinx/install.py` adds two lifecycle hooks and copies `harbor_api.py`
and `relay.py` into Jinx's `integrations/agent_harbor/`. It requires the inspected
SHA-256 of `discord-bot.py`, backs up the original code and `.gitignore` outside
the checkout, and excludes the private bridge key from Git. A graceful restart of
the exact supervised Jinx process loads the optional interface. The marker
`.harbor-api-enabled` controls startup; removing it and restarting disables the
bridge without changing Jinx's other capabilities.

Raw Harbor exchanges and receipts live under
`memory-engine/staging/harbor-transcripts/`. A turn ID is idempotent: retries with
identical content reuse its receipt; changed content with the same ID is refused.
If summarization fails, the raw exchange remains and Harbor reports the failure.
A saved receipt confirms staging, not later promotion.

Validation includes authenticated access, excluded destructive tools, write
approval, current-context assembly, idempotent archives, SSH-input validation,
cancelled requests, and visible memory failures after an otherwise successful
reply. September 7 live checks verified memory retrieval, new-task recall, archive
receipts, teammate discovery and a real `ask_bot` reply, followed by document,
spreadsheet, PDF, image, audio and video-frame review. These do not establish
continuous monitoring, complete transcript visibility or a fresh installer test.
See the [current handoff](plans/current-handoff.md) for the verification scope.

An ordinary Harbor restart does not require restarting Jinx or reinstalling the
bridge. The Mini's original-code backup is not a complete memory backup. Back up
Jinx's memory and any remote archives under their existing procedures before a
future migration. No Grokbot data import has been performed.
