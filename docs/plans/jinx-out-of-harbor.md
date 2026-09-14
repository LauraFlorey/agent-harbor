# Sprint: Jinx out of Agent Harbor

Status: docs complete on this PR (`cursor/compare-librechat-2ab7`). Merge to `main` still open. Product decision: Jinx is a working relationship on **Discord**, not a surface inside Agent Harbor.

This is a **boundary sprint**, not a Discord integration and not a memory-product build.

## Outcome

Harbor no longer describes, plans, or special-cases Jinx as:

- Chief of Staff of the Harbor / Life OS / memory ecosystem
- a knowledge base Harbor must call
- an app that must be started, deployed, or cleaned up with Harbor

After this sprint, a reader of README / VISION / ARCHITECTURE / ROADMAP can tell: **Harbor runs agents and policy. Jinx lives on Discord.**

## Why now

VISION previously described Jinx as possible “Chief of Staff across the ecosystem” and Sprint 8 was “Life OS and Jinx Memory APIs.” That fought how the owner actually works with Jinx (Discord chat) and would pull Harbor toward a second product.

This sprint records the current decision in README, VISION, ARCHITECTURE, and ROADMAP. Code already has **no** `Jinx` identifiers. The coupling was documentary and architectural. Cheap to cut; expensive if Sprint 8 had started.

The in-app **Chief of Staff** toggle (`server/chief-of-staff.ts`, Settings) stays. It is a generic coordinator bot for the local team. It is not Jinx. Do not rename it to Jinx. Do not wire it to Discord.

## Done when

1. README, VISION, ARCHITECTURE, and ROADMAP state the Discord boundary in current-decision language (not only a historical banner).
2. Sprint 8 is no longer “build Jinx Memory APIs into Harbor.”
3. A grep of `src/`, `server/`, and `electron/` for `Jinx` / `jinx` is empty (already true; keep it that way).
4. Harbor still runs with Life OS and Jinx both absent — same as today.
5. No Discord bot, gateway, or message sync is added.

## Stories (small)

| Story | Work | Not |
|---|---|---|
| D1 Docs boundary | This file + README/VISION/ARCHITECTURE/ROADMAP edits | Rewriting every historical plan |
| D2 CoS is not Jinx | One sentence in Settings copy if needed: coordinator for *this workspace*, not an external person | Removing CoS |
| D3 Cancel Jinx APIs | Roadmap Sprint 8 → deferred/cancelled as a Harbor milestone | Building a Jinx Memory service |
| D4 Audit | Grep + confirm `docs/deployment.md` still forbids Jinx in Harbor deploy/cleanup | Touching Discord |

## Explicit non-goals

- Discord bot, slash commands, or mirroring Harbor threads into Discord.
- Importing Discord history into Harbor transcripts.
- A Jinx Memory retrieval API, RAG, or shared database.
- Making Jinx a Harbor bot with a reserved name.
- Life OS work (separate decision).
- Upstream OpenMausBot sync.

If Harbor agents later need a *fact* Jinx already knows, the owner pastes or files it. Harbor may grow ordinary local search/backup later; that is not Jinx.

## Suggested sequence after this sprint

Do **not** start Life OS APIs next.

1. **Local VM live acceptance** (Sprint C remainder): one real reversible task, no spurious approval wall, no mid-turn lease abort. That is still the starved capability axis.
2. **Owner backup/restore** of `~/.openmausbot` (Roadmap Sprint 10 slice; also comparison P0.2). Discord is where Jinx lives; Harbor still needs recoverable *agent* state.
3. Stall calibration already in Harbor: tool timeout vs lease timeout, remaining-budget nudge — only if live VM work shows they still bite.

## Validation

- Docs read as one product story.
- `rg -i jinx src server electron` → no matches.
- App still launches; CoS toggle still elects a local bot.
- No new network listeners.
