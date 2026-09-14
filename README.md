# Agent Harbor

Agent Harbor is Laura's private desktop workspace for a team of AI agents. Talk
with Jinx, work with specialists, choose local or cloud models, and give each
agent the files, tools and computer access appropriate to its work.

**Current documentation: September 7, 2026.** The recent changes are running
from a modified local source checkout on Laura's Mac. They are not a newly
packaged, installed or published release. See the [current handoff](docs/plans/current-handoff.md)
for verification and remaining gaps.

## Start here

- [Using Agent Harbor](docs/using-agent-harbor.md): conversations, Jinx, files, emoji and pictures.
- [Documentation index](docs/README.md): current guides and historical design records.
- [Vision](VISION.md), [architecture](ARCHITECTURE.md) and [roadmap](ROADMAP.md): direction, implementation and remaining work.

## What it can do

| Capability | Current behavior |
|---|---|
| Choose a model | Configured CLI/ACP engines, OpenRouter, a local OpenAI-compatible server, or the existing Jinx service. Availability depends on the selected engine and its setup. |
| Talk with Jinx | The Chief of Staff connects over SSH to the existing Jinx process and memory system on the Mac Mini. Harbor and Discord keep separate live conversations. |
| Coordinate agents | Jinx can discover teammates and their busy/idle status, ask an available teammate for a reply, or delegate work. She does not automatically read every teammate's conversation or continuously monitor them. |
| Work with notes | Scoped text-file tools can read, search and save notes in a permitted folder, including an Obsidian vault. |
| Share documents and media | Attach documents, spreadsheets, PDFs, images, audio and video. Speech is transcribed locally; video uses selected still frames plus speech. Visual interpretation requires a vision-capable model. |
| Take actions | OpenRouter and Jinx direct conversations have application-owned file, command, connected-app, schedule and teammate tools where configured. Host desktop actions require an explicitly selected computer and permissions. |
| Work privately with a local model | Local-model direct conversations have notes, schedules and attachment tools, with no Harbor cloud fallback, cloud apps, commands, desktop control or cloud delegation. |
| Personalize agents | Per-agent instructions, profile pictures or animated mascots, emoji in messages and user-added message reactions. |
| Speak and schedule | Configured ElevenLabs voices, macOS dictation and calls, plus local routines and webhook triggers. Direct local chat disables cloud voice; group voice has a [remaining privacy gap](docs/voice-mode.md). Harbor must remain running for local schedules and webhooks. |

Rooms support collaboration and attachment reading. The general API-model action
tool set described above is for **direct conversations**; rooms do not inherit
all of those tools. The experimental OpenRouter **Local VM** route has its own
restricted tool set and unfinished live acceptance. It is distinct from
**This computer**. See [OpenRouter](docs/openrouter.md).

## Storage and privacy

Harbor's agents, conversations, events, schedules, attachment copies and settings
live under `~/.openmausbot/`. The compatibility name is intentional. macOS
credentials use Keychain; Windows/Linux use a private fallback file. Agent
profile pictures are stored in the local agent record.

Local storage and local inference are separate choices. Cloud models receive the
conversation context and file content used for a task. Connected apps and
ElevenLabs use their respective services. Jinx's identity and memory stay with
her existing Mini system, including any existing remote archive services. The
Harbor connection does not relocate those archives.

The local-model connection accepts only literal loopback addresses. Configure
its inference server to run locally. Choosing an Obsidian folder does not upload
the whole vault; reading a note supplies that content to the selected model.
See [local work](docs/local-work.md), [Jinx](docs/jinx-connection.md),
[attachments](docs/attachments.md) and [security boundaries](SECURITY.md).

## Run from source

Use Node 24+ and pnpm 10.33.0 in this checkout:

```sh
pnpm install --frozen-lockfile
pnpm dev:all
```

The unified launcher starts the local API, interface and Electron app. Closing
the window or pressing Control-C in the launcher terminal stops its development
processes. Configure at least one provider: a logged-in agent CLI, an API key,
a running local model server, or the Jinx bridge. A CLI is not required for
API-backed or local-model chat.

Default endpoints are API `127.0.0.1:8799`, interface `127.0.0.1:5199`, and the
separate webhook receiver `127.0.0.1:8800`. The app API has no user authentication
and must remain on loopback. Remote access to Harbor over Tailscale is future
work, not a configured feature of this installation.

For checks, packages, platform limits, media dependencies and backups, use the
[installation and recovery guide](docs/deployment.md). The new attachment and
media workflow has been verified on the current Mac source runtime; its
fresh-machine installer dependency coverage remains unverified.

## Project scope and origin

No public Agent Harbor release is currently planned. This is product intent,
not a statement that repository visibility or old release artifacts were checked.
Grokbot data migration is deferred while Laura tries Harbor. No import is
implied by connecting Jinx.

Agent Harbor is based on the MIT-licensed
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) project and retains
[MIT attribution](LICENSE) © 2026 Milind Soni, Laura Florey, and contributors.
The [rebrand boundary](docs/agent-harbor-rebrand.md) explains retained identifiers.
Agent Harbor has no cryptocurrency token and is not affiliated with xAI.
