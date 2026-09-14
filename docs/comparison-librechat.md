# Agent Harbor compared with LibreChat

Status: research snapshot against this Agent Harbor checkout (`0.1.21`) and a read-only clone of [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) at `v0.8.8-rc3` (2026-09-14). This is a comparison for the Agent Harbor owner, not a feature-parity checklist.

LibreChat is a mature, self-hosted, multi-user chat UI that unifies many LLM APIs. Agent Harbor is a smaller, local-first control plane for a personal team of agents, with explicit computer-access policy. This is not a copy-LibreChat brief. The useful questions are how they attach computers at all, whether agents stall, and what they do about it — then which of those *ideas* (not their stack) overlap Harbor’s lease and timeout problems.

## How to read this

- **Cite paths** are from the two codebases as inspected. LibreChat also documents product behavior at [librechat.ai/docs](https://www.librechat.ai/docs); Agent Harbor documents it in-repo.
- **Effort** is technical size, not calendar time: **S** = a few files; **M** = a bounded UI + server + test story; **L** = a new subsystem or a careful migration.
- Rows marked **intentional** are product-scope differences. Closing them blindly would fight Agent Harbor’s design.

---

## High-level summary

### Agent Harbor

A local workspace for running a team of AI agents with conversations, tasks, rooms, and explicit computer-access controls. It is an Electron desktop shell around a React UI and a loopback Node harness. Providers are adapters (local CLIs, ACP, OpenRouter). Approvals, leases, redaction, and fail-closed routing are application-owned, not prompt-owned.

Evidence: `README.md`, `VISION.md`, `ARCHITECTURE.md`, `package.json`, `electron/`, `src/`, `server/`.

| Attribute | Current state |
|---|---|
| Product | Personal/local-first agent control plane (friends-and-family beta; public source in preparation) |
| Version | `0.1.21` (`package.json`) |
| Origin | Fork of OpenMausBot; MIT; rebrand keeps `~/.openmausbot` and `OMB_*` for compatibility (`docs/agent-harbor-rebrand.md`) |
| Runtime | Electron + Vite/React UI + local HTTP/SSE harness on `127.0.0.1` |
| Persistence | JSON files under `~/.openmausbot` (`server/config.ts`, `server/store.ts`) |
| Auth | Single-owner loopback bearer; desktop IPC; `pnpm dev:access` for a browser tab (`server/api-security.ts`, `src/lib/api-auth.ts`) |
| Providers | Built-in drivers: Grok, Grok Agent, Gemini Agent, Kimi, Droid, OpenCode Go, OpenRouter, Claude, Codex, Antigravity, Box Agent (`server/drivers/builtIn.ts`) |
| Computers | Per-agent destination: off / Local VM / this computer / cloud box (`src/lib/computer-destinations.ts`) |
| Tests | ~83 Vitest files plus updater/node tests; CI on macOS, Ubuntu, Windows (`.github/workflows/ci.yml`) |
| Deploy | Source `pnpm dev:all`; unsigned Electron packages; no Docker Compose / Helm for the app itself |

`VISION.md` still records an earlier private-only product decision (“no planned public or open-source Agent Harbor release”). `README.md` and `ARCHITECTURE.md` record a later public-source preparation decision. Treat that mismatch as a docs problem, not as two products.

### LibreChat

A self-hosted “all-in-one AI conversations” platform: ChatGPT-like UI, many HTTP LLM endpoints, agents/tools/MCP, RAG, code interpreter, artifacts, speech, admin, and enterprise auth. It is a multi-process web stack meant to be deployed (Docker, Helm, one-click hosts), not a desktop agent runtime.

Evidence: LibreChat `README.md`, `package.json` (`v0.8.8-rc3`), `docker-compose.yml`, `api/server/index.js`, `client/`, `packages/`.

| Attribute | Current state |
|---|---|
| Product | Self-hosted multi-provider chat platform with agents as a major feature |
| Community | ~43k GitHub stars, ~9k forks, Discord, docs site, translations, sponsors (repo metadata + README) |
| Runtime | Express API + Vite/React client + MongoDB + Meilisearch + pgvector RAG API + optional Redis + admin panel |
| Persistence | MongoDB (Mongoose schemas in `packages/data-schemas`); files local/S3/Azure/Firebase/CloudFront |
| Auth | JWT + local email, OAuth (Google/GitHub/Discord/Apple/Facebook), LDAP, OpenID, SAML (`api/strategies/`) |
| Providers | OpenAI, Azure, Anthropic, Bedrock, Google/Vertex, OpenRouter, and any OpenAI-compatible custom endpoint (`librechat.example.yaml`, README) |
| Agents | First-class but still chat-platform-shaped: marketplace, skills, subagents, MCP, experimental attached workspaces, HITL (`packages/api/src/agents/`, README “What’s New”) |
| Tests | ~1,300 spec/test files; Playwright e2e, a11y, Lighthouse, Docker smoke, Helm, i18n (`.github/workflows/`, ~30 workflows) |
| Deploy | `docker-compose.yml`, Helm charts (`helm/librechat`), Railway/Zeabur/Sealos buttons |

---

## Computers and stalling (the actual question)

LibreChat is **not** running a desktop the way Agent Harbor is. They do not have CUA, screenshots/clicks/typing, or a per-bot destination of off / Local VM / this computer / cloud box. Their “computer” story is file-and-shell workers plus a language sandbox. They *are* fighting stall-class failures, but the failures look like quiet HTTP workers, tool-call loops, and lost job leases — not a GUI VM whose exclusive lease expired mid-click.

### How LibreChat attaches computers

Three layers, none of which is Harbor’s model:

| Layer | What it is | Where |
|---|---|---|
| **Code Interpreter** | ClickHouse-hosted sandbox: run Python/Node/Go/etc., upload/download files. Isolated language execution, not a desktop. | README; `packages/api/src/utils/code.ts` |
| **Managed code environments** | Deployment-owned workers the server talks to over HTTP (`type: 'managed'`). | `packages/api/src/code/environments.ts` |
| **Attached / personal workers** | Highly experimental (v0.8.8-rc3). A user enrolls a worker; LibreChat pairs it (`packages/api/src/code/bridge.ts`) and then lets agents list/read/search/edit files and run Bash in a chosen workspace. README: “inspect trees, read and search files, author changes, and run Bash with bounded timeouts.” | README “What’s New”; `packages/api/src/code/workspace.ts`, `command.ts`; PRs such as [#15352](https://github.com/danny-avila/LibreChat/pull/15352), [#15546](https://github.com/danny-avila/LibreChat/pull/15546) |

A worker reports `offline | starting | ready` and a `leaseExpiresInMs` (`CodeBridgeWorkerStatus` in `packages/api/src/code/bridge.ts`). Pairing and lifecycle calls fail as `timeout` / `busy` / `failed`. Commands are HTTP tools with a **30s default timeout and a 5-minute hard cap** (`WORKSPACE_COMMAND_DEFAULT_TIMEOUT_MS` / `WORKSPACE_COMMAND_MAX_TIMEOUT_MS` in `packages/api/src/code/workspace.ts`; same numbers in `packages/data-provider/src/config.ts`). There is also a 30s queue wait plus a few seconds of transport/settlement grace. A timed-out command is supposed to return `timedOut` on the tool result, not hang the chat forever.

Personal enrollment is capped (`packages/api/src/code/enrollment.ts`, default 5 per user) and can be disabled. Isolation, mounts, and privileged execution are deliberately *not* user-tunable (`codeEnvironmentUserConfigSchema` comment in `packages/data-provider/src/config.ts`).

**Vs Harbor:** Harbor’s destinations are real computers with a GUI/MCP driver — Local VM (`server/container-computer.ts`), this Mac via CUA (`server/local-computer.ts`, macOS-only), cloud Box (`server/box.ts` + `server/remote-computer.ts`). The agent sees screen, clicks, and shell under Harbor-owned approvals. LibreChat’s attached worker is closer to “a remote repo + bash with a deadline.” Their code interpreter is closer to “run this snippet in a jail.” Neither is “drive a desktop.”

### Are they stalling? Yes — and they built a lot of recovery around it

Evidence they treat stalls as a live problem:

- README v0.8.8-rc3: “Strengthened Agent continuation and checkpoint recovery.”
- Tests named for stalls: “bounds stalled activity and still attempts terminal delivery” (`packages/api/src/agents/subagentThreads.spec.ts`); “bounds a stalled replacement lookup” (`packages/api/src/stream/__tests__/startup.spec.ts`).
- UI: [PR #15013](https://github.com/danny-avila/LibreChat/pull/15013) “Never Let a Stalled Attachment Disable the Composer.”
- Infra comment: keep-alive sockets from the code-server path were **killing unrelated requests after idle timeout** (`packages/api/src/utils/code.ts`). That is a real stall/cascade they had to special-case (`keepAlive: false` on dedicated agents).
- Background tools: dead-claim recovery so a tool whose owner died does not leave the turn waiting forever (`createBackgroundToolDeadClaimRecovery` in `packages/api/src/agents/backgroundCompletionWakeup.ts`, wired from `api/server/services/Endpoints/agents/backgroundCompletion.js`).
- Triggers/schedules: Mongo leases, heartbeats, retries, and **dead letters** (`packages/api/src/agents/triggers/README.md`). At-least-once delivery; exhausted retries become durable dead letters instead of spinning.

They do **not** appear to have Harbor’s exact “Local VM lease ended before the turn completed” bug, because they do not have that VM. Their equivalent is “the worker went quiet / the generation lease was not renewed / the graph hit recursionLimit with no final answer.”

### How they stop a stall

| Mechanism | What it does | Harbor analogue |
|---|---|---|
| **Per-command timeout** | Bash/workspace HTTP dies at 30s (max 5 min). Tool result can say `timedOut`. | Box commands `AbortSignal.timeout(120_000)` (`server/box.ts`). Local VM tool execution 30s, MCP request 20s (`server/tool-turn-control.ts`). |
| **Turn / graph budget** | LangGraph `recursionLimit`; after a few remaining rounds they inject a “wrap up, stop calling tools” system notice (`packages/api/src/agents/stepBudget.ts`). Hitting the wall mid-turn is called out as “the user waits for a turn that ends without an answer.” | Max 32 tool calls, max 3 repeats, 20 min elapsed turn (`DEFAULT_LOCAL_VM_TOOL_TURN_LIMITS`). No “please finish now” notice to the model. |
| **Lease + heartbeat** | Event-child generations: 30s TTL, 10s heartbeat. Lost lease **aborts the generation and retries abort until stop is confirmed** (`packages/api/src/agents/triggers/lease.ts`). | Exclusive Local VM turn lease; Sprint C renews it on turn *progress observations* so a healthy long turn is not killed (`server/local-vm-tool-turn.ts` `observe` → `renewLocalVmTurnLease`). Idle VM suspends separately (`server/local-vm-idle.ts`). |
| **Checkpoint / HITL resume** | Pause for approval, persist LangGraph checkpoint, resume later; resumable streams (optional Redis) so a dropped connection is not a stuck agent (README; `packages/api/src/types/stream.ts`). | Approval wait is in-process (10 min). No cross-restart checkpoint. Interrupt is cancel/cleanup of the current turn. |
| **Dead claims / dead letters** | Background tool and trigger work that loses its owner is recovered or parked, not left blocking the UI. | Unattended/routines exist (`server/routines.ts`, `server/webhooks.ts`) but there is no dead-letter queue for a wedged Local VM turn. |
| **Cancel ordinary background tools** | README: optionally cancel background tools, including attached Bash, while detached subagents stay independent. | User can stop a turn; Local VM disable drains active turns (`SECURITY.md`). |

LibreChat’s lease code is built for **many replicas and Redis/Mongo**. Harbor is one desktop process. Copying their job store would be the wrong shape. The portable ideas are: every computer action has a deadline; progress must heartbeat the lease; a quiet worker fails the *tool*, not the whole destination; a model that will loop forever needs an explicit remaining-budget nudge; a lost owner must abort until drain is confirmed.

### How Harbor stalls today (so the comparison is fair)

Harbor’s own docs already name two stall-shaped failures, and they are not LibreChat’s:

1. **Lease expiry mid-turn.** `docs/plans/openrouter-local-vm-tool-loop.md` and `ROADMAP.md` Sprint 0: a later Local VM turn reported **“Local VM lease ended before the turn completed.”** Renewal used to depend on external `touch()`; a long provider/tool wait outlived the TTL. Sprint C heartbeats from the turn’s own observations (`server/local-vm-tool-turn.ts`). Live acceptance of a full browser-action sequence is still outstanding.
2. **Approval walls that look like stalls.** Over-broad “consequential” matching on argument text (`ROADMAP.md`) paused or refused reversible work. Recalibrated by declared effect, not keywords — again pending live acceptance.

So: LibreChat stalls on **HTTP workers, graphs, and multi-replica job ownership**. Harbor stalls on **exclusive VM leases and approval calibration**. Both use leases + timeouts. Harbor’s problem is harder on the computer-use axis (GUI, exclusive destination, fail-closed routing) and simpler on the distributed-systems axis (no Redis, one owner).

### What is worth stealing as an idea (not as code)

- Keep **tool-level** timeouts so a hung Bash/MCP call cannot be the thing that expires the *computer lease*. LibreChat already separates “this command timed out” from “this worker is gone.”
- A **remaining-budget nudge** before the hard tool-call cap, so the model writes an answer instead of dying silently at 32 calls (`stepBudget.ts` vs Harbor’s hard `maxToolCalls`).
- **Abort-until-drained** when a lease is lost (LibreChat retries abort every 250ms until stop is confirmed). Harbor already aborts the turn controller; confirming MCP/child drain the same way is the close analogue.
- Treat **offline workers** as a visible destination state (LibreChat’s `offline | starting | ready`), not as a hang. Harbor already has instance snapshots and engine-setup UI; computer destinations could use the same honesty.

Do not steal: Redis GenerationJobManager, Mongo trigger leases, LangGraph checkpointers, or pairing a generic “code worker” as a substitute for the Local VM / Box / host destinations.

---

## Intentional differences (do not treat as defects)

These are different products that happen to share “talk to an LLM in a browser-shaped UI.”

| Dimension | Agent Harbor | LibreChat | Why it is not a 1:1 gap |
|---|---|---|---|
| Primary object | **Agent** (bot identity, instructions, tools, environment, run evidence) | **Conversation** (endpoint + model + optional agent) | Harbor owns policy around workers. LibreChat owns a unified chat surface. |
| Audience | One owner on their machines | Many users on a deployment | Multi-user ACL, balances, admin, SSO are LibreChat’s job. |
| Trust boundary | Runtime + approvals; models are untrusted | Deployment + roles + tenant isolation; models are mostly HTTP APIs | Harbor’s hard problem is *what the agent may do on a computer*. LibreChat’s is *who may use which model/file in a hosted service*. |
| Where work runs | Local CLI process, isolated Local VM, cloud computer, or host (opt-in) | Server-side tool calls, sandboxed code interpreter, experimental attached workspaces | Copying LibreChat’s hosted interpreter does not replace Harbor’s destination model. |
| Knowledge | Explicitly **not** owned here. Jinx lives on Discord; Harbor has no Jinx Memory API (`VISION.md`, `ARCHITECTURE.md`) | Built-in RAG API + file search + memories | Harbor should not grow a memory product to “complete” the control plane. |
| Shipping form | Desktop app, loopback API, unsigned packages for now | Always-on web service, containers, k8s | Docker/Helm are table stakes for LibreChat and optional-at-best for Harbor. |
| Config style | Small `config.json` + Keychain + a handful of `OMB_*` env vars | 1,400+ line `.env.example` + 1,300+ line `librechat.example.yaml` | Harbor’s constraint is *few, owner-visible knobs*. |
| Privacy default | No analytics SDK; profile stays local (`README.md`, `docs/security-hardening-results.md`) | Optional OTel, Langfuse, RUM, Insights | Adding hosted telemetry would contradict Harbor’s privacy claim. |

LibreChat is also moving *toward* Harbor’s territory: attached code workspaces, Ask/Allow/Deny for writes and commands, and HITL tool approval (`README.md` v0.8.8-rc3; `packages/api/src/agents/hitl/policy.ts`). Those layers are still incomplete there (agent/skills policy “not yet wired”; workspaces “highly experimental”). Harbor already treats that problem as the product.

---

## Architecture and stack

| | Agent Harbor | LibreChat |
|---|---|---|
| UI | React 19 + Vite 7 + Tailwind 4 (`src/`, `package.json`) | React client + Vite + Tailwind + Radix + i18next (`client/package.json`) |
| API | Hand-rolled Node HTTP router in `server/index.ts` (~2.8k lines) plus a few `server/routes/*` | Express 5 app (`api/server/index.js`) with modular `api/server/routes/` |
| Domain types | `server/contracts.ts` (harness events, drivers, tool loop) | `packages/data-schemas` + `packages/data-provider` + `@librechat/agents` |
| Process model | `scripts/dev-all.mjs` starts server + Vite + Electron; packaged app runs the server as an Electron `utilityProcess` (`electron/main.mjs`) | `api` container + Mongo + Meili + vectordb + `rag_api` + `admin-panel` (`docker-compose.yml`) |
| Events | One authenticated SSE stream (`GET /api/events`) folded into a client reducer (`src/state/store.tsx`) | Generation streams, optional Redis-backed resumable streams, multi-tab sync |
| Size (order of magnitude) | ~53k non-test LOC in `server/` + `src/` + `electron/`; ~14k test LOC; repo ~10 MB | Thousands of source files; ~1,300 test files; repo ~300 MB on GitHub |

Harbor’s adapter rule is explicit: providers, MCP, computers, and environments must not silently change permission semantics (`ARCHITECTURE.md`). LibreChat’s equivalent is a large endpoint/agent/MCP stack with YAML policy, Redis, and Mongo — powerful, and much heavier.

**Harbor maintenance note:** `server/index.ts` is already called out as oversized in `docs/security-hardening-results.md`. LibreChat’s route split is worth *imitating as modularization*, not as Express+Mongoose.

---

## Auth, identity, and tenancy

**Agent Harbor** is a single-owner local app:

- Random 32-byte hex bearer, written to mode `0600` `session-<port>.json` only after bind (`server/api-security.ts`).
- Exact Host + loopback Origin checks; `/api/health` is the public exception; `/api/internal/*` rejects browser `Origin` and uses a separate agent credential.
- Renderer keeps the token in memory; `workspaceFetch` never puts it in URLs, cookies, or `localStorage` (`src/lib/api-auth.ts`).
- Electron IPC requires an owned window and trusted main frame (`electron/security.cjs`).
- Same-OS-user processes with filesystem/Keychain access are out of scope (`SECURITY.md`).

**LibreChat** is a multi-user service:

- Passport strategies: local, JWT, LDAP, OpenID, SAML, Google, GitHub, Discord, Apple, Facebook (`api/strategies/`).
- Roles, groups, tenants, shared links, token balances, admin grants (`api/server/routes/`, `packages/api/src/acl/`).
- Default Docker Mongo is `--noauth` (`docker-compose.yml`) — convenient for local compose, not a pattern Harbor should copy.

**Fair takeaway:** Harbor’s auth is the right shape for a desktop control plane. LibreChat’s SSO/RBAC is the right shape for a hosted product. The LibreChat idea worth stealing is *operational completeness* (password reset, 2FA rate limits, invite flows) **only if** Harbor ever becomes multi-user. It should not, on current vision.

---

## Multi-provider LLM support

**Agent Harbor** normalizes *local agent runtimes*:

- Driver registry with shadow snapshots for unknown/broken drivers (`server/harness/registry.ts`) — a newer config cannot crash the fleet.
- Claude and Codex as local CLIs with permission sockets / sandboxes (`server/drivers/claude.ts`, `server/drivers/codex.ts`).
- ACP family: Gemini, Kimi, Droid, Grok Agent, OpenCode Go (`server/drivers/acp/`).
- OpenRouter as an HTTP driver with a narrow, default-off Local VM tool loop (`server/drivers/openrouter.ts`, `docs/openrouter.md`).
- Model picker routes by exact `instanceId`, never infers from driver kind (`src/components/ModelPicker.tsx`).
- Engine setup copy comes from driver-declared install descriptors, not hardcoded UI strings (`src/components/EngineSetup.tsx`).

**LibreChat** normalizes *HTTP chat endpoints*:

- First-class OpenAI / Azure / Anthropic / Bedrock / Google / Vertex / Responses API, plus custom OpenAI-compatible URLs (README; `librechat.example.yaml`).
- Mid-chat endpoint and preset switching, model specs, token config (`api/server/routes/endpoints.js`, `api/server/routes/presets.js`).
- Local models via Ollama and other OpenAI-compatible servers — no requirement that a provider CLI be installed on the laptop.

**Fair takeaway:** Harbor is stronger at “this specialist is Claude Code in its workspace.” LibreChat is stronger at “this chat is GPT-5 / Claude / a local Ollama model, switch anytime.” A thin OpenAI-compatible *driver* in Harbor would help people who only have an API key and no CLI. It should remain an adapter, not a second product.

---

## Agents, tools, MCP, computers

| Capability | Agent Harbor | LibreChat |
|---|---|---|
| Named specialists | Bots with identity, instructions, model binding, computer destination (`server/store.ts`) | Agents with tools, files, skills, marketplace, sharing (README; `packages/api/src/agents/`) |
| Rooms | Shared threads, bulletin, @mentions, bot↔bot DMs (`server/store.ts` `GroupRecord`) | Projects, shared links, multi-convo; not the same “several specialists in one room” model |
| Peer agents | Harness-owned `ask_bot` / `delegate-bot` with recursion limits (`server/index.ts` `/api/internal/*`, `server/delegations.ts`) | Subagents with isolated context (`packages/api/src/agents/subagent*.ts`) |
| MCP | Stdio client with schema/size/tool-count limits, guardian process, approval-gated execution (`server/mcp-client.ts`, `server/mcp-guardian.ts`) | Large MCP registry, OAuth, Redis cache, YAML servers (`packages/api/src/mcp/`, ~142 files) |
| Approvals | Application-owned channel: no self-approval, no prompt/MCP as authority, routine vs consequential, redaction (`server/tool-approval.ts`, `SECURITY.md`) | HITL Ask/Allow/Deny; endpoint YAML is the kill switch; agent/skills layers reserved and not merged yet (`packages/api/src/agents/hitl/policy.ts`) |
| Computers | Explicit per-bot destination; Local VM lease + heartbeat + exclusive routing (`server/local-vm-lease.ts`, `server/container-computer.ts`) | Experimental attached workspaces + ClickHouse interpreter: file/shell workers, not a GUI desktop. See [Computers and stalling](#computers-and-stalling-the-actual-question) |
| Connected apps | Composio catalog in-app (`src/components/PluginsPanel.tsx`, `server/composio.ts`) | OpenAPI actions, MCP, plugins, SharePoint, etc. |
| Scheduling | Routines + authenticated webhooks (`server/routines.ts`, `server/webhooks.ts`, `server/webhook-ingress.ts`) | Experimental schedules gated on Redis/checkpointer (`librechat.example.yaml`) |

Harbor’s MCP path is narrower (stdio, turn-scoped, fail-closed) and more tightly bound to approvals. LibreChat’s MCP path is a deployment feature (OAuth, many servers, per-user connections). LibreChat’s own MCP authority-proof module is still “additive, default-off” and “existing paths do not invoke it yet” (`packages/api/src/mcp/authority/README.md`). Do not copy that complexity until Harbor has a real multi-server MCP settings surface.

---

## RAG, files, and knowledge

**Agent Harbor today**

- Composer attachments are either long pastes inlined as `<pasted-text>` or **path chips** (`<attached-file path="…"/>`) for Electron-dropped files (`src/lib/composer-attachments.ts`).
- There is no upload store, no embeddings, no “chat with this PDF” pipeline, and no in-app conversation search (no matches in `src/` for message search).
- Architecture assigns durable knowledge **outside** Harbor. Jinx lives on Discord; there is no Jinx Memory retrieval path (`ARCHITECTURE.md`, `VISION.md`).

**LibreChat today**

- Unified attachments routed to the model or extracted text; File Search and Code tools provisioned when needed (README).
- Separate `rag_api` + pgvector (`docker-compose.yml`); file strategies for local/S3/Azure/Firebase/CloudFront (`librechat.example.yaml`).
- Conversation search via Meilisearch; memories routes (`api/server/routes/search.js`, `memories.js`).
- Import from LibreChat / ChatGPT / Chatbot UI; export screenshot/markdown/text/json (README).

**Fair takeaway:** Harbor should not stand up Meilisearch + pgvector to “catch up.” It *should* make files and history usable for a single owner: land dropped files in the agent workspace, search local transcripts, and export/backup the data directory. Retrieval beyond that stays out of Harbor unless Laura later decides to own knowledge here as a separate product (not as a Jinx Memory API).

---

## UI / UX

| | Agent Harbor | LibreChat |
|---|---|---|
| Layout | Sidebar of bots/rooms + chat/group/routines (`src/App.tsx`) | ChatGPT-like unified sidebar, endpoints, agents, prompts, files, MCP (`client/src/components/`) |
| Theme | Dark-only palette sampled from the upstream UI (`src/styles.css`) | Light, dark, system, high-contrast (README) |
| i18n | English UI strings in components | ~40 locale folders under `client/src/locales/` |
| Chat | Markdown + Shiki, branching via `parentId`, reactions, approvals, activity chips (`src/components/ChatView.tsx`, `server/branching.test.ts`) | Fork, compact, rich copy, reasoning UI, artifacts, presets, bookmarks |
| Voice | ElevenLabs TTS; macOS dictation helper; call overlay (`server/tts/`, `electron/speech.mjs`, `docs/voice-mode.md`) | STT/TTS via OpenAI, Azure, ElevenLabs (README) |
| Onboarding | Local email gate (optional, not sent anywhere) (`src/lib/onboarding.ts`) | Full auth + new-user flows |
| A11y | Manual labels on some controls (e.g. drawer button in `src/App.tsx`); no a11y CI | axe-linter workflow, Playwright a11y config (`.github/workflows/a11y.yml`) |

Harbor’s UX strengths are agent-centric: mascot identity, computer panel, approval cards that show the actual tool (`src/components/ApprovalCard.tsx`), engine-missing setup that matches driver metadata. LibreChat’s UX strengths are chat-platform completeness: search, themes, i18n, presets, import/export, artifacts.

For a personal desktop app, **search, backup, file landing, and a system/light theme** beat **40 languages and an agent marketplace**.

---

## Config and environment

**Agent Harbor**

- Non-secrets: `~/.openmausbot/config.json`.
- Secrets: macOS Keychain (`com.openmausbot.app.secrets`) or mode `0600` `secrets.json`; API returns `configured` booleans, never values (`server/config.ts`, `server/secret-store.ts`).
- Env: `OMB_PORT`, `OMB_DATA_DIR`, `OMB_UI_ORIGIN`, `AGENT_HARBOR_DEV_PORT`, plus provider env fallbacks (`OPENROUTER_API_KEY`, etc.). Documented in `README.md` / `docs/deployment.md`, not in a single `.env.example`.
- No Docker Compose / Dockerfile for the app (Docker is a *destination* for the Local VM: `server/container-computer.ts`).

**LibreChat**

- `.env.example` (~1,448 lines) and `librechat.example.yaml` (~1,388 lines) covering server, Mongo pool, auth, endpoints, MCP, files, Langfuse, schedules, and more.
- Live admin overrides without redeploy (README admin panel).

**Fair takeaway:** Harbor should add a short **config reference** (env + `config.json` + Keychain IDs + data-dir layout). It should not add LibreChat’s configuration surface area.

---

## Docker, desktop, and deployment

| | Agent Harbor | LibreChat |
|---|---|---|
| Happy path | `pnpm install --frozen-lockfile` then `pnpm dev:all` (`README.md`) | Docker Compose stack (`docker-compose.yml`) or Node + Mongo |
| Packages | electron-builder mac/win/linux; `--publish never`; signing deferred (`electron-builder.yml`, `docs/deployment.md`) | Container images, Helm (`helm/librechat/Chart.yaml` appVersion `v0.8.8-rc3`) |
| Updates | Coordinator present but disabled until signed provenance (`electron/updater.mjs`, `SECURITY.md`) | `npm run update` / deployed-update scripts (`package.json`) |
| Recovery | Roadmap Sprint 10: backup/restore/rollback not complete (`ROADMAP.md`, `ARCHITECTURE.md` known gaps) | Volume binds for data, images, uploads, logs; still operator-owned |

Harbor’s deployment problem is **signed installers + owner recovery**, not Kubernetes. LibreChat’s is **a reproducible multi-service stack**. Copying Helm would be a product-scope change.

---

## Testing, CI, and DX

**Agent Harbor**

- Vitest for server/UI logic; fake CLIs for Claude/Codex/ACP (`server/testing/`).
- `pnpm test:desktop-security` Electron smoke (auth, CSP-ish navigation, no token in storage) on macOS CI.
- Linux package verify + xvfb smoke (`.github/workflows/ci.yml`).
- Security workflow: `pnpm audit`, checksum-pinned Gitleaks, dependency-review on public PRs (`.github/workflows/security.yml`).
- CONTRIBUTING requires frozen lockfile, focused PRs, disposable test data, no weakening of approval gates (`CONTRIBUTING.md`).
- No Playwright, no visual e2e of chat, no i18n/a11y gates.

**LibreChat**

- Jest per package; Playwright mock e2e with in-process fake LLM (`e2e/README.md`).
- Bombadil property-based browser testing; Lighthouse; Redis transport e2e.
- ~30 GitHub workflows (backend/frontend review, Docker smoke/publish, Helm, i18n sync, a11y).
- Husky + `static-checks` on commit (`.github/CONTRIBUTING.md`).
- Conventional commits, `dev` vs `main` GitFlow.

**Fair takeaway:** Harbor’s unit/security tests are dense for the repo size and already use fake providers — a LibreChat-quality *mock browser* loop is the missing layer, not a 30-workflow CI org. Prefer one Playwright (or Playwright-via-Electron) path for: open workspace → send turn → approval card → reject/allow.

---

## Docs and community patterns

| | Agent Harbor | LibreChat |
|---|---|---|
| README | Honest beta limits, signing deferral, permissions, privacy | Feature landing page, badges, deploy buttons, changelog |
| In-repo docs | Strong: architecture, vision, roadmap, security results, beta, computer-use, OpenRouter | Thin in-repo (`docs/` is small); real docs live on librechat.ai |
| Templates | Bug + feature issue forms; short PR template | Bug, feature, language, Locize access; CoC, funding |
| Security reporting | GitHub private reporting; detailed threat model in `SECURITY.md` | Private advisory + Discord first-contact; 72h ack target (`.github/SECURITY.md`) |
| Community | Not a public contributor program per `VISION.md` non-goals | Discord, YouTube, translation program, sponsors |

Harbor’s in-repo docs are a strength (especially the threat model). The weakness is **mixed era language** (private-only vision vs public-source README) and **no single “how testers configure this” page** comparable to LibreChat’s dotenv guide — at Harbor scale, that can be two pages, not a site.

---

## Strengths of Agent Harbor relative to LibreChat

1. **The product is the control plane.** Bots, destinations, approvals, leases, and evidence are first-class. LibreChat still frames agents as a chat-platform feature; attached computers are experimental.
2. **Fail-closed computer-use policy, tested.** Consequential gates, unlinkable capabilities, exclusive Local VM leases, redaction, no prompt/MCP self-approval (`server/tool-approval.ts`, `server/local-vm-lease.ts`, `SECURITY.md`). LibreChat’s HITL YAML is less complete and still has unwired layers.
3. **Local-first privacy.** No analytics SDK, Keychain/0600 secrets, loopback bind, session token never in storage (`docs/security-hardening-results.md`, `src/lib/api-auth.ts`).
4. **CLI/ACP provider model.** Claude Code / Codex / Gemini / etc. as they actually run on a machine, with install descriptors in the UI (`server/drivers/builtIn.ts`, `src/components/EngineSetup.tsx`).
5. **Forward-compatible driver registry.** Unknown drivers become unavailable shadows instead of crashing startup (`server/harness/registry.ts`).
6. **Small, inspectable stack.** JSON files, one Node process, Electron shell. A personal owner can reason about `~/.openmausbot`. LibreChat requires Mongo + search + vectors + optional Redis to be “complete.”
7. **Honest verification language.** README platform matrix, “implemented ≠ live-accepted,” release states in `docs/deployment.md`. LibreChat’s README is marketing-complete; Harbor’s is operationally cautious.
8. **Dense negative tests for the security substrate.** Approvals, env isolation, secret store, API security, computer observation URL redaction (`server/*.test.ts`). Relative to size, this is ahead of “typical chat UI.”
9. **Team primitives LibreChat does not really have:** rooms with bulletins, team manifest export/import (`server/team-manifest.ts`), peer comms, webhook ingress on a dedicated loopback port.

---

## Gaps and weaknesses (fair ones)

These are places LibreChat is better *and* the improvement would still fit Harbor.

| Gap | Why it matters for Harbor | LibreChat evidence |
|---|---|---|
| No owner backup/restore/export of the data dir | Sprint 10; success in `VISION.md` includes restore/rollback; currently incomplete | Import/export conversations; volume-backed data |
| No conversation/message search | A team of specialists produces a lot of transcripts in JSON files; grep is not a product | Meilisearch-backed search |
| Files are path chips, not workspace material | Agents need the file in *their* cwd; inlining paths is easy to get wrong on Windows and in VMs | Unified attachments + file search + code files |
| Giant `server/index.ts` | Harder to review routes; already noted as leftover maintenance | Modular `api/server/routes/` |
| No UI e2e of chat + approval | Unit tests + one Electron auth smoke; regressions in ChatView/approvals can slip | Playwright mock profile + HITL e2e |
| Dark-only UI, English-only | Fine for one owner; worse for friends-and-family testers | Themes + locales |
| Thin public config reference | Testers must assemble `OMB_*` + Keychain + data dir from README paragraphs | `.env.example` + docs site (too large to copy, but the *index* is useful) |
| Docs era mismatch | `VISION.md` / `ROADMAP.md` / `docs/plans/current-handoff.md` still say private-only | Single public product story |
| API-only providers | OpenRouter exists; Azure/Bedrock/Ollama-style HTTP is not first-class | Custom endpoints |
| Context/cost visibility | Runtime events include cost/tokens (`server/contracts.ts`) but the UI is not a LibreChat-style context meter | Context Usage + compaction |
| Accessibility CI | Keyboard shortcuts exist (`src/App.tsx`); no automated a11y | axe-linter + a11y Playwright |
| MCP settings UX | MCP is a harness implementation detail for computers/agents, not an owner-editable server list | YAML MCP servers + in-app MCP UI |

**Not scored as gaps (intentional):** multi-user SSO, admin panel, token billing, Helm, agent marketplace, Langfuse, 40-language i18n, DALL·E/artifacts as core features, Meilisearch/pgvector.

---

## Prioritized recommendations

Inspired by LibreChat where the *job* matches. Implement in Harbor’s architecture (JSON store, loopback auth, driver adapters, approval channel).

### P0 — high leverage for the actual product

| ID | Recommendation | Why | Effort | LibreChat inspiration, Harbor shape |
|---|---|---|---|---|
| P0.1 | **Reconcile public-facing scope docs.** Add a short “current decision” banner to `VISION.md` / `ROADMAP.md` / `docs/plans/current-handoff.md` pointing at `README.md` + `docs/release-readiness.md`. | Testers and future contributors currently get two stories. Trust is Harbor’s brand. | S | LibreChat’s README and changelog tell one product story. |
| P0.2 | **Owner backup / restore of Harbor-owned state.** Export `~/.openmausbot` (bots, transcripts, events, non-secret config) to a dated archive; restore with a “do not clobber secrets unless opted in” rule. | `VISION.md` success criteria and Sprint 10; LibreChat users can at least export chats. A desktop agent app that cannot be restored is fragile. | M | Conversation import/export — but backup the *workspace*, not only markdown. |
| P0.3 | **Local transcript search.** Filter bots/rooms/messages in the sidebar from the existing JSON store. | Daily driver UX; no search engine required at this scale. | M | LibreChat search, implemented as in-memory/index-on-boot over `messages-*.json`. |
| P0.4 | **Put dropped files in the agent workspace.** Copy or link into `agent-workspace` (or the active destination) and send the agent a path *inside* that workspace. Keep the chip UI. | Today’s `<attached-file path="…">` is host-centric and fights VM/cloud destinations. | M | Unified attachments, without RAG. |
| P0.5 | **One config reference page** (`docs/config.md`): data dir layout, secret IDs, `OMB_*`, loopback ports, what is *not* configured by env. Link it from README. | Friends-and-family setup is the current release path. | S | LibreChat dotenv docs, 1% of the size. |

### P1 — next, still on-identity

| ID | Recommendation | Why | Effort | Harbor shape |
|---|---|---|---|---|
| P1.1 | **Chat + approval Playwright (or Electron) e2e** using existing fake CLIs. | LibreChat’s mock e2e is the right idea: no live keys, deterministic HITL. Harbor already has `server/testing/fake-*-cli.ts`. | M | One spec: send → permission card → deny; send → allow observation. |
| P1.2 | **Split `server/index.ts` by route family** (bots, events, computers, connectors, routines) following `server/routes/config.ts`. | Reviewability and security diffs. Not a framework rewrite. | M | LibreChat’s route modules as a *pattern*. |
| P1.3 | **Conversation export** (JSON + markdown of the active branch). Team manifest already exists (`server/team-manifest.ts`); chats do not. | Portability and support; complements P0.2. | S–M | LibreChat export formats, minus screenshot-as-a-platform. |
| P1.4 | **Context / cost chip in the thread** from existing `thread.token-usage.updated` and `turn.completed.cost`. | Operators of agent fleets need runway, not just chat. | S | LibreChat Context Usage, as a small Harbor indicator. |
| P1.5 | **Optional OpenAI-compatible HTTP driver** (Ollama / any `/v1/chat/completions`) beside OpenRouter. | Covers “I have a local model and no CLI” without Azure/Bedrock enterprise surface. | M | LibreChat custom endpoints, one driver, Harbor contracts. |
| P1.6 | **System / light theme.** | Dark-only (`src/styles.css`) is a tester-friction issue, not a brand identity. Keep the harbor palette. | M | LibreChat appearance modes. |
| P1.7 | **Owner-editable MCP server list** (stdio only, secrets in Keychain, never in args — already required in `server/contracts.ts`). | Today MCP is mostly an internal computer/agent bridge. LibreChat shows owners want to attach tools. Stay stdio + approval-gated. | M | `librechat.yaml` MCP, as a Settings panel, not OAuth/Redis. |
| P1.8 | **Thread compaction as a Harbor action** (summarize-only turn, preserve recent leaf). | Long specialist threads will hit CLI context limits. | M | LibreChat manual compaction; Harbor should treat summary as untrusted evidence (`ARCHITECTURE.md`). |
| P1.9 | **Accessibility pass** on composer, approval card, and sidebar (labels, focus, contrast), plus a cheap lint or Playwright a11y spec. | Approvals are a security surface; they must be operable. | M | LibreChat a11y CI, scoped to Harbor’s few screens. |
| P1.10 | **Stall calibration, not a job queue.** (1) Fail a hung *tool* before the computer *lease* expires. (2) Nudge the model before `maxToolCalls`. (3) Abort-until-drained on lease loss. | Harbor’s stall is lease/approval, not Redis. LibreChat already separates command timeout from worker death (`packages/api/src/code/workspace.ts`, `stepBudget.ts`, event-child lease abort retry). | M | Keep `server/tool-turn-control.ts` + `local-vm-lease.ts`; do not add GenerationJobManager. |

### P2 — only if the product decision changes

| ID | Recommendation | Why it waits |
|---|---|---|
| P2.1 | i18n | One-owner English app; Locize-scale translation is LibreChat community overhead. |
| P2.2 | Artifacts / sandpack / image generation | Chat-platform features; Harbor’s equivalent is “the agent did it on a computer.” |
| P2.3 | Built-in vector RAG | Jinx is on Discord, not a Harbor knowledge layer. RAG would still be a new product inside the control plane — do not add it to “complete” Harbor. |
| P2.4 | Docker Compose / Helm for a hosted Harbor | Changes the threat model (bind 0.0.0.0, multi-user, reverse proxy). Would need a *new* auth story. |
| P2.5 | SSO, LDAP, token balances, admin panel | Multi-tenant product. Out of scope in `VISION.md`. |
| P2.6 | Default OTel/Langfuse | Conflicts with the no-analytics privacy claim unless strictly local and opt-in. |
| P2.7 | Agent marketplace / public sharing | Harbor teams are personal specialists; sharing a manifest (`server/team-manifest.ts`) is enough. |

---

## What **not** to copy from LibreChat

1. **Feature-parity-with-ChatGPT as a roadmap.** Artifacts, DALL·E, plugins, bookmarks, multi-convo, 40 locales, and an admin panel would drown the control-plane identity.
2. **The data plane.** MongoDB + Meilisearch + pgvector + Redis is the cost of a hosted multi-user app. Harbor’s JSON directory is a feature.
3. **Default compose Mongo `--noauth`.** Convenient, not a security example (`docker-compose.yml`).
4. **Passport/SSO and token spend.** Wrong audience.
5. **1,400-line env files.** Harbor should stay explainable on one page (P0.5).
6. **Hosted telemetry by default.** OTel/Langfuse/RUM/Insights would undo `README.md` privacy language.
7. **MCP-OAuth-Redis-Mongo authority proofs.** LibreChat’s own module is default-off and unused by existing paths (`packages/api/src/mcp/authority/README.md`). Harbor’s smaller stdio + approval model is healthier until there is a concrete multi-server need.
8. **Express + Mongoose + bun dual-runtime.** Harbor already has contracts and Vitest. A framework swap is not an improvement.
9. **GitFlow `dev`/`main` and 30 workflows.** Keep the current small CI (typecheck, tests, package smoke, gitleaks). Add one UI e2e job, not an org chart.
10. **One-click cloud deploy buttons.** They train users to expose a loopback agent harness to the internet.
11. **Marketing README as a substitute for limits.** Keep the platform matrix, unsigned-installer warnings, and “not live-accepted” language. Steal LibreChat’s *clarity*, not its badge wall.
12. **Treating YAML policy as the security boundary for computer use.** LibreChat still uses endpoint YAML as the HITL kill switch with unwired agent/skill layers. Harbor should keep deterministic code as authority (`VISION.md` principle 2).

---

## Suggested reading order in this repo after this comparison

1. `README.md` — what testers can actually run.
2. `VISION.md` + `ARCHITECTURE.md` — intended product (note the public-source banner vs older private-only sentences).
3. `SECURITY.md` + `docs/security-hardening-results.md` — current threat model.
4. `ROADMAP.md` — capability calibration vs remaining sprints (instruction stack, assets, recovery).
5. This file — what to borrow from a mature chat platform without becoming one.
6. [OpenMausBot recent upstream](upstream-openmausbot-recent.md) — what the original fork shipped after Harbor’s 2026-08-16 sync, especially computers and stalls.

---

## Source snapshot

| Project | Ref inspected |
|---|---|
| Agent Harbor | This repository, version `0.1.21`, branch as of the comparison commit |
| LibreChat | https://github.com/danny-avila/LibreChat `v0.8.8-rc3` (README, `package.json`, Docker/Helm, `api/`, `client/`, `packages/`, `.github/`) |

LibreChat continues to ship quickly; re-check README “What’s New” before using this as a claim about their agents/workspaces months later. Agent Harbor’s numbers (test counts, LOC) will also drift; the **product-shape** distinction is the stable part.
