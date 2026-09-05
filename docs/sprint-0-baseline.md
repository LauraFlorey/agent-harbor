# Sprint 0 Baseline — Agent Harbor

Status: baseline map as of 30 August 2026. Branch `codex/personal-action-capabilities`, checkpoint `4403d90`.
Purpose: freeze a trustworthy picture of what exists before Sprint 1 reshapes it. This reconciles the roadmap and `VISION.md` / `ARCHITECTURE.md` against the actual code. Where the code and the docs disagree, the code wins and the gap is named.

## 1. What actually exists today

Agent Harbor is a real, substantially built local-first desktop app — further along than "early" implies. Stack: Electron 43 + React 19 + Vite + TypeScript, pnpm workspace, Node ≥24. 358 tracked files (174 `.ts`, 37 `.tsx`), 78 test files.

Three layers:
- **Desktop shell** (`electron/`) — boots the embedded server, exposes platform capabilities (speech, screen capture, local computer control via `@trycua/cua-driver`, auto-updater).
- **Interface** (`src/`, React) — chat, approvals, model picker, rooms/groups, routines, computer panel, connectors, onboarding.
- **Local harness server** (`server/`, ~93 modules) — a single local HTTP API (`server/index.ts`, ~2,900 lines) plus one SSE event stream, a provider registry + event bus (`server/harness/`), a multi-provider driver layer, approval and permission controls, routines, webhooks, MCP clients, computer destinations, a secret store, redaction, delegations, peer approval, and a workspace chief-of-staff.

## 2. The task path, traced through real code

Confirms Eval Gate 0's "what happens from Laura's task to the final result":

1. **UI → server.** `src/` sends a typed request to the local API. Routes include `/api/bots`, `/api/routines`, `/api/webhooks`, `/api/groups` (rooms), `/api/local-computer`, `/api/connectors`, `/api/internal/{ask-bot,delegate-bot}`; live updates arrive over `/api/events` (SSE). Dispatch is `const path = url.pathname` in `server/index.ts`.
2. **Resolve provider.** `server/harness/registry.ts` resolves the selected provider instance and capabilities; unknown providers degrade to unavailable rather than crashing the fleet.
3. **Start/resume the turn.** A driver in `server/drivers/*` (claude, codex, codex-cli, grok, openrouter, native, acp, antigravity, agents-proxy, boxagent, dweb-proxy, builtIn) runs the provider turn behind a shared contract.
4. **Tool loop.** `server/provider-tool-loop.ts` runs the provider-neutral model↔tool continuation. By design it holds **no** approval authority, limits, or cleanup — those stay outside the loop. This is "the model is never the security boundary," implemented.
5. **Permission decision.** Tool/permission requests pass through application-owned controls (see §5) before any tool executes; a denial returns a frozen "Denied by the user" result and forbids further tool calls.
6. **Events + storage.** Normalized runtime events flow through `server/harness/bus.ts` to the SSE stream and are persisted by `server/store.ts` (atomic writes via `server/atomic.ts`).
7. **Distinct end states.** Completion, failure, interruption, cost, and cleanup remain distinct — not collapsed into one "done."

## 3. Component classification

| Component | Location | Maps to primitive | Class | Notes |
|---|---|---|---|---|
| Desktop shell | `electron/main.mjs` + `electron/*` | — | Infrastructure | Boots services, platform capabilities, updater |
| Computer-use bridge | `electron/cua*.cjs/mjs`, `@trycua/cua-driver` | Environment / Tool | Adapter | Local computer control |
| React interface | `src/` | (all, as surfaces) | UI | Chat, approvals, rooms, routines, connectors |
| Local API | `server/index.ts` (~2,900 ln) | — | Core domain + Infra | **Monolith; decomposition target** |
| Provider registry + event bus | `server/harness/registry.ts`, `bus.ts` | Model / Run | Core domain | Turn routing, fan-in event stream |
| Provider drivers | `server/drivers/*` | Model | Adapter | claude, codex(-cli), grok, openrouter, native, acp, antigravity, agents-proxy, boxagent, dweb-proxy, builtIn |
| Tool loop | `server/provider-tool-loop.ts` | Tool | Core domain | Provider-neutral; authority sits outside it |
| Runtime types | `server/contracts.ts` | (schema) | Core domain | Partial — not yet the full 8-primitive typed domain |
| Approvals / permissions | `server/tool-approval.ts`, `auto-approve.ts`, `peer-approval.ts`, `tool-turn-control.ts`, `permission-proxy.ts`, `mcp-guardian.ts`, `local-vm-routine-authorization.ts` | Permission/Approval (cross-cutting) | Core domain | See §5 |
| Persistent state | `server/store.ts`, `atomic.ts`, `config.ts` | Run / Agent | Infrastructure (system of record) | Persists under `~/.openmausbot/` — residue |
| Credential broker | `server/secret-store.ts` | (security) | Core domain | Persists `~/.openmausbot.app.secrets` — residue path |
| Log redaction | `server/redact.ts` | (security) | Core domain | Success + error paths |
| Routines / webhooks | `server/routines.ts`, `webhooks.ts`, `webhook-ingress.ts` | Run (triggers) | Core domain | Scheduled + webhook-driven runs |
| Environments | `server/box*.ts`, `container-computer.ts`, `container-mcp.ts`, `agent-environment.ts`, `agent-workspace.ts` | Environment | Core domain + Adapter | Sandbox / VM / container provisioning |
| Computer destinations | `server/local-computer.ts`, `remote-computer.ts`, `computer-observation.ts`, `computer-proxy.ts` | Environment / Tool | Adapter | Multiple destinations |
| OpenRouter Local VM path | `server/openrouter-local-vm.ts`, `local-vm-lease.ts`, `local-vm-idle.ts`, `local-vm-tool-turn.ts`, `local-vm-mcp.ts` | Environment / Run | Core domain | **Current acceptance path; incomplete** |
| MCP clients | `server/mcp-client.ts`, `container-mcp.ts`, `local-vm-mcp.ts` | Tool | Adapter | Pin protocol version + test authz (roadmap) |
| Connected apps | `server/composio.ts`, `/api/connectors` | Tool | Adapter | Composio integration |
| Chief of Staff | `server/chief-of-staff.ts` | Agent | Core domain | Workspace coordinator |
| Delegation | `server/delegations.ts` | Agent (child) | Core domain | Child authority subset |
| Team manifest | `server/team-manifest.ts` | Agent | Core domain | Agent registry / import-export |
| Notifications | `server/notify.ts`, `comms.ts` | — | Infrastructure | — |
| Voice | `server/tts/`, `electron/speech.mjs` | Tool | Adapter/Feature | TTS + push-to-talk |
| OpenMausBot identifiers | `~/.openmausbot/`, `com.openmausbot.app.desktop`, `.omb-scratch`, `src/types/ogb.d.ts`, `*agents-proxy*` | — | **Historical residue** | Fork origin; migration needed |

## 4. System of record per primitive (current)

| Primitive | Where it lives today | State |
|---|---|---|
| Agent | `team-manifest.ts` + `store.ts` (bots) | Exists, not yet a stable typed identity separate from provider IDs |
| Model | `harness/registry.ts` + `config.ts` | Exists via driver registry |
| Instruction | scattered; `AGENTS.md`/`USER.md`/`LAURA.md` stack **not yet formalized in code** | Gap |
| Tool | driver tool defs + `mcp-client.ts`; approvals in `tool-approval.ts` | Exists |
| Asset | `composer-attachments.ts` | Partial — no formal scoped-asset store with retention |
| Room | `/api/groups`, `group-routing.ts`, `group-call.ts` | Exists |
| Environment | `box*`, `container-*`, `local-vm-*`, computer modules | Exists |
| Run | `harness/bus.ts` events + `store.ts` transcripts | **Not yet a replayable, versioned ledger** — biggest gap |

## 5. Where every permission decision is made

- `server/tool-approval.ts` — the approval gate; raises `ToolApprovalError` / `approval_denied`.
- `server/auto-approve.ts` — the attended-task routine grant (task-scoped, non-transferable).
- `server/peer-approval.ts` + `peer-approval-key.ts` — peer/second-party approval.
- `server/tool-turn-control.ts` — per-turn tool gating.
- `server/permission-proxy.ts` — permission mediation for proxied calls.
- `server/mcp-guardian.ts` — MCP request guarding.
- `server/local-vm-routine-authorization.ts` — Local VM routine authorization.
- `server/unattended.ts` — unattended-run authorization boundaries.

Natural-language → structured `ALLOW`/`ASK`/`DENY` policy compilation and trusted high-risk typed challenges are **not yet implemented** (roadmap Sprint 2/4).

## 6. Historical residue & reconciliation gaps

Confirms the six gaps already listed in `ARCHITECTURE.md`, and adds specifics:

- **`~/.openmausbot/` persistence.** `config.ts` and `secret-store.ts` read/write the OpenMausBot state paths (`config.json`, `.openmausbot.app.secrets`). Renaming requires a tested migration, not a find-replace.
- **Pervasive `omb`/`ogb` identifiers** across ~20 files (`src/types/ogb.d.ts`, `.omb-scratch`, `agents-proxy`, `com.openmausbot.app.desktop`).
- **`server/index.ts` is a ~2,900-line monolith** — the single biggest structural residue; per-resource command modules would make Sprint 1 safer.
- **The 8 primitives are not yet one formal typed domain** (`contracts.ts` is runtime types, not the stable domain).
- **No replayable run ledger** (events + transcripts exist; immutable versioned records + redacted summaries do not).
- **Life OS and Jinx Memory integrations are not implemented here** (correct — they are separate apps).
- **The full Local VM browser-action + recovery sequence is not live-accepted**; the roadmap's lease-ended error is unresolved against the current implementation.
- **Backup / restore / rollback / owner-ready recovery are not complete.**

## 7. Eval Gate 0 — status

Met, with unknowns listed rather than hidden:

- Task path traceable end to end — §2. ✔
- Every permission decision site identified — §5. ✔
- System of record pointed to for each primitive, gaps named — §4. ✔

Remaining unknowns / not verified this pass:
- **Test suite pass/fail not run** (78 test files present). Recommend `pnpm typecheck` and `pnpm test` to establish a green baseline before Sprint 1.
- Per-route request/response contract shapes not enumerated field-by-field.
- The Local VM lease-ended error is not reproduced or root-caused here.

## 8. Bridge to Sprint 1

In priority order:
1. **Formalize the eight primitives** as one typed domain (extend `contracts.ts`), separating stable IDs from provider-native IDs, preserving migration compatibility.
2. **Stand up the run ledger** — immutable event records plus redacted derived summaries. This is the largest missing primitive and everything auditable depends on it.
3. **Decide the state namespace** — migrate `~/.openmausbot/` → an `agent-harbor` path with a tested migration, or consciously keep it and document why.
4. **Decompose `server/index.ts`** into per-resource command modules so Sprint 1's contract work is reviewable.
5. **Establish the green baseline** — run and record `pnpm typecheck` + `pnpm test`.
