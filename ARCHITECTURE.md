# Agent Harbor architecture

Status: current architecture map for public source version **0.1.21**.
Product boundaries (Discord/Jinx, no signed installers) match
[VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md).

This document separates what exists on `main` from what the roadmap proposes.
Exact live-acceptance and PR state: [current handoff](docs/plans/current-handoff.md).

## System boundary

Agent Harbor owns agent execution and the controls around it. **Jinx lives on
Discord**, outside this repository. Life OS, if it happens, would be a
separate companion app — not a Harbor subsystem and not a Jinx Memory service
inside this codebase.

```mermaid
flowchart LR
    C[Chief of Staff\nlocal coordinator bot]
    H[Agent Harbor\nagents, policy, execution, evidence]
    A[Provider and tool adapters]
    E[Local, VM, or cloud environments]

    C --> H
    H --> A
    A --> E
```

Harbor must remain useful with Discord, Jinx, and Life OS all absent. There is
no Jinx Memory retrieval path, Discord gateway, or reserved bot named Jinx.
Pasted Discord content and other external material are evidence, not execution
authority. The in-app Chief of Staff (`server/chief-of-staff.ts`) is a generic
workspace coordinator. It is not Jinx. Discord is out of band and not a Harbor
adapter.

## Current implementation

The current application is an Electron desktop shell around a React interface
and a local harness server. Default loopback ports: API `8799`, UI `5199`,
webhook ingress `8800`. Auth is a per-server bearer; the desktop injects it over
IPC, a browser tab uses `pnpm dev:access`.

| Layer | Current location | Responsibility |
|---|---|---|
| Desktop shell | `electron/` | Starts the embedded services and exposes platform capabilities such as speech, screen capture, and local computer control. |
| Interface | `src/` | Chat, agent settings, model selection, rooms, approvals, connected apps, and computer controls. |
| Local API | `server/index.ts` | Typed commands for bots, turns, approvals, models, computers, connectors, and configuration over HTTP plus one SSE event stream. |
| Harness | `server/harness/` | Provider registry, live instances, turn routing, and the fan-in event bus. |
| Provider adapters | `server/drivers/` | Normalize local CLI, ACP, OpenRouter, and computer-provider behavior behind shared contracts. |
| Persistent compatibility state | `~/.openmausbot/` | Current local bot, transcript, event, configuration, and fallback-secret paths. Renaming requires a tested migration. |

Computer destinations (off, isolated Local VM, this computer, cloud Box) are
per-agent and fail closed as `off`. The in-app Chief of Staff
(`server/chief-of-staff.ts`) is a generic workspace coordinator.

The canonical runtime types live in `server/contracts.ts`. Unknown providers
degrade to an unavailable state instead of crashing the fleet. The interface
does not talk directly to provider transports.

## Current execution path

1. The interface sends a typed request to the local server.
2. The harness resolves the selected provider instance and capabilities.
3. The driver starts or resumes the agent turn.
4. Runtime events are normalized and written to the event stream.
5. Tool or permission requests pass through application-owned controls.
6. The interface presents decisions and folds resulting events into the thread.
7. Completion, failure, interruption, cost, and cleanup remain distinct states.

## Stable domain concepts

The target domain uses eight stable primitives:

| Primitive | Question it answers |
|---|---|
| Agent | Who is responsible for the work? |
| Model | What intelligence powers this turn? |
| Instruction | How is behavior and context composed? |
| Tool | What information or action capability is available? |
| Asset | What material may the agent see or produce? |
| Room | Who and what collaborate in this context? |
| Environment | Where does execution occur? |
| Run | What happened under which versioned conditions? |

Permission, approval, evaluation, budget, audit, and policy are cross-cutting
controls rather than ordinary context objects. Parts of these concepts exist
today, but the complete typed domain and replayable run ledger are roadmap work.

## Instruction and policy boundary

The intended instruction order is:

1. Agent Harbor system and security rules
2. `AGENTS.md` (when present)
3. `USER.md` or owner profile instructions (when present)
4. agent instructions
5. project instructions
6. room instructions
7. the current task

Lower layers may specialize behavior but cannot expand authority. Web pages,
email, PDFs, tool output, retrieved memory, and other agents remain untrusted or
semi-trusted evidence.

Natural-language policy is compiled into structured `ALLOW`, `ASK`, or `DENY`
decisions with target, action, environment, data class, budget, and expiry.
Material ambiguity fails closed or returns to Laura for clarification.

## Approval model

- Routine and reversible Local VM actions may use one explicit, task-scoped
  approval during an attended task.
- The task grant expires with that task and does not transfer to another agent,
  destination, or session.
- Consequential actions require a fresh decision for each attempt.
- High-risk or irreversible actions require a human-only confirmation surface
  that an agent cannot focus, type into, or satisfy.
- Prompts, model output, MCP servers, copied approval data, and UI automation are
  never approval authorities.

`main` implements the attended-task routine grant, exclusive Local VM lease
(including renewal on turn progress), and separate consequential pauses for the
experimental OpenRouter Local VM path. Broader policy compilation, trusted
high-risk challenges, and **live Local VM acceptance** remain open.

## Security boundaries

Agent Harbor should enforce:

- least privilege by target, action, environment, and data class;
- separate read and write authority;
- credential handles rather than raw reusable secrets in model context;
- explicit network destinations and bounded egress;
- time, cost, tool-call, retry, result-size, and delegation limits;
- child authority that is never broader than parent authority;
- cancellation, lease cleanup, revocation, and recovery;
- redacted audit evidence; and
- fail-closed behavior for unknown or ambiguous authority.

Security-sensitive changes use focused stories and concise negative checks.
Passing tests are implementation evidence, not proof of an installed or
recovery-tested personal capability.

## Private state

Protected personal state includes credentials, connected accounts, client
project context, site inventories, tuned specialists, health records, private
prompts, Obsidian/Open Brain material, and any Life OS data that later exists.
These values do not belong in the public repository, model logs, crash
reports, screenshots, or broadly shared provider context. Discord and Jinx are
out of band; if Laura pastes that material into Harbor, it is still private
transcript evidence, not a memory product.

Agent Harbor stores only what it owns or what a bounded run requires. Do not
add Discord, Jinx Memory, or Life OS APIs to this repo to “complete” Harbor.
See [`docs/plans/jinx-out-of-harbor.md`](docs/plans/jinx-out-of-harbor.md).

## Adapter rule

Providers, MCP, A2A, connected apps, browsers, computer-control systems, and
execution environments remain adapters. An adapter declares its capabilities,
version, security assumptions, and degradation behavior. Changing an adapter
must not silently change permission or data-ownership semantics.

## Known architecture gaps

- The repository does not yet have the complete versioned instruction stack.
- The eight primitives are not yet formalized as one stable domain model.
- Run evidence is not yet a complete replayable ledger.
- Discord, Jinx, and Life OS integrations are intentionally not implemented
  here. Keep `src/`, `server/`, and `electron/` free of Jinx identifiers.
- The full Local VM browser-action and recovery sequence is not live-accepted.
- Backup, restoration, rollback, and owner-ready recovery are not complete.
- Signed installers, notarization, and automatic updates are not established.
  Source on GitHub is the supported distribution path.
