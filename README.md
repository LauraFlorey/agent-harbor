# Agent Harbor

A local-first **control plane** for a personal team of AI agents: conversations, tasks, rooms, and explicit policy over each agent's computer access.

This project **started as a fork of [OpenMausBot](https://github.com/milind-soni/OpenMausBot)**. It is maintained independently by Laura Florey. OpenMausBot remains a separate product; Agent Harbor is not a drop-in replacement, a Grok Bot clone, or a hosted chat platform.

Agent Harbor has no cryptocurrency or token affiliation.

## What it is

- A desktop workspace (Electron + a loopback harness) that runs **your** provider CLIs and API keys.
- Per-agent identity, instructions, model selection, and computer destination (off, isolated Local VM, this computer, or a cloud box).
- Approvals, leases, and fail-closed routing in application code — not in the prompt.
- Direct chats, shared rooms, tasks, optional routines and webhooks.

Jinx is **not** part of Agent Harbor. That working relationship lives on Discord. Harbor does not host her memory, personality, or Chief of Staff role.

## What it is not

- Not OpenMausBot's messaging-app roadmap (mobile clients, hosted fleet, team marketplace).
- Not LibreChat: Harbor is not a multi-user ChatGPT-style web service.
- Not a knowledge base, CRM, or Life OS. Those stay other apps if they exist at all.

## Origin and attribution

Forked from OpenMausBot at the start of this repository. The MIT license and upstream copyright are preserved in [LICENSE](LICENSE). Display names, icons, and docs are Agent Harbor; some on-disk paths stay `~/.openmausbot` and `OMB_*` so existing local data and Keychain items keep working. Details: [rebrand boundary](docs/agent-harbor-rebrand.md).

Harbor last reviewed upstream at OpenMausBot `0.1.21` (2026-08-16). Later OpenMausBot releases are a different product line (Apache-2.0 + `enterprise/`, Android/iOS, hosted workspaces). See [recent upstream notes](docs/upstream-openmausbot-recent.md) if you need that delta; do not treat it as a merge checklist.

## Run from source

Node.js 24+ and pnpm 10.33.0. Clone this repository, open a terminal in its folder, then:

```sh
pnpm install --frozen-lockfile
pnpm dev:all
```

That starts the harness, the interface, and the Electron app. Closing the window or Control-C stops the stack. Default loopback ports: API `8799`, UI `5199`, webhook ingress `8800`.

You can chat with an OpenRouter API key without installing a provider CLI. For Claude or Codex, install that CLI and sign in through it.

The desktop app authenticates itself. A separate browser tab needs an access code, shown only when you run:

```sh
pnpm dev:access
```

Paste it into the local UI. It lives in tab memory and dies when the server restarts. Do not share it.

`OMB_PORT`, `OMB_DATA_DIR`, and `AGENT_HARBOR_DEV_PORT` isolate extra instances. If you start processes separately, set `OMB_UI_ORIGIN` on the server to the exact UI origin (default `http://127.0.0.1:5199`).

## Beta status

**No publicly trusted, signed installers yet.** Mac test packages are ad-hoc signed and not notarized; Windows test installers are unsigned. Automatic updates are off. Source setup does not need a paid Apple or Microsoft developer account.

| Capability | Apple Silicon Mac | Windows x64 |
|---|---|---|
| Agents, text chat, model selection, tasks, rooms | Initial beta | Initial beta |
| Microphone dictation | Implemented; live voice acceptance pending | Not supported |
| Direct control and preview of this computer | Explicit permissions; experimental | Not supported |
| Local VM, cloud computers, connected apps, scheduling | Optional; extra setup | Optional; extra setup |

Intel Macs and Windows on ARM are not validated. You supply your own provider account; usage can cost money. Start with computer access and host-folder access **off**. See the [beta testing guide](docs/beta-testing.md).

Unsigned packages may warn or be blocked. Do not turn off system protections to participate. [Apple](https://support.apple.com/102445) · [Microsoft Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview).

## Permissions

- Computer access starts **off**. Home-directory start and host-desktop attach are separate opt-ins.
- OpenRouter's Local VM loop is default-off and model-allowlisted. Routine observation is narrow; shell, clicks, typing, and unknown tools need a fresh decision. [OpenRouter](docs/openrouter.md).
- A working directory is not an OS sandbox. Auto mode, connected apps, and provider CLIs can grant real authority.

## Privacy and local data

No analytics SDK. Optional profile stays on disk. Prompts and tool results still go to the provider **you** chose.

Data directory: `~/.openmausbot` (legacy path, on purpose). Secrets: macOS Keychain, or mode `0600` `secrets.json` elsewhere. The API returns `configured` flags, never key values. Session codes are never put in URLs, cookies, or agent environments.

## Development checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm check:electron
pnpm build
pnpm build:server
pnpm check:server-package
pnpm audit --audit-level=moderate
```

CI runs tests and packaging on macOS, Ubuntu, and Windows, plus dependency and history-secret scans.

## Deployment

Source is the supported path while signing is deferred. Package scripts use `--publish never`. A green build is not a signed release. [Deployment](docs/deployment.md) · [release checklist](docs/release-readiness.md).

## Documents

- [Architecture](ARCHITECTURE.md) · [Vision](VISION.md) · [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)
- Next sprint: [Jinx out of Harbor](docs/plans/jinx-out-of-harbor.md)
- Research only: [LibreChat comparison](docs/comparison-librechat.md)

## License

[MIT](LICENSE). Copyright of Milind Soni and OpenMausBot contributors is retained for the original work; Agent Harbor changes are copyright Laura Florey and contributors.
