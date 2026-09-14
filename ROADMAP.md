# Agent Harbor roadmap

Status: public-source product roadmap for version **0.1.21**. Signed installers
and a GitHub Release with binaries are not current milestones.

Source: [github.com/LauraFlorey/agent-harbor](https://github.com/LauraFlorey/agent-harbor).
Everyday work is pull requests into `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Current checkpoint

- **`origin/main`** is `d92dd96` (merged 2026-09-05): public-source hardening,
  beta-testing docs, team-import fix. Version `0.1.21`. The repository is
  **public**. There are no GitHub Releases and no signed installers.
- **Open documentation PR:** `cursor/compare-librechat-2ab7` /
  [PR #30](https://github.com/LauraFlorey/agent-harbor/pull/30) — Harbor README,
  clone/install, screenshots, Jinx/Discord boundary, LibreChat and OpenMausBot
  research notes. Not merged yet.
- **Sprint C code is on `main`:** Local VM lease heartbeat from turn progress
  (`server/local-vm-tool-turn.ts` → `renewLocalVmTurnLease`) and consequential-gate
  recalibration. Automated tests cover the code. **Live Local VM acceptance is
  still open** — one real reversible task, no spurious approval wall, no
  mid-turn lease abort, observed on a prepared VM.
- Security substrate on `main`: approval integrity, unlinkable per-turn
  capabilities, exclusive VM leases, circuit breakers, delegation ceilings,
  peer approval, redaction, secret store, append-only per-thread events, atomic
  persistence, routines, webhooks.
- **Jinx stays on Discord.** She is not a Harbor surface. Sprint 8 (Life OS and
  Jinx Memory APIs) is **cancelled** as a Harbor milestone. See
  [`docs/plans/jinx-out-of-harbor.md`](docs/plans/jinx-out-of-harbor.md).
- Life OS, if it happens, is a later separate app — not the next sprint.

The starved axis is still **capability**: agents chatting is easy; a trustworthy
computer destination is not live-accepted.

## Sprint 0 finding (historical) — capability, not missing controls

Reconciled August 30, 2026 against the code. Sprints 1, 4, and 7 were already
substantially built. Two mechanisms were choking real Local VM work:

1. **Over-broad consequential gate.** `tool-approval.ts` still uses effect plus
   keyword patterns (`HIGH_IMPACT` and friends). Crude argument scans can flag
   benign reversible actions. Calibration continues; do not remove the gate.
2. **Lease expiry mid-turn.** The August 30 failure was “Local VM lease ended
   before the turn completed” because the turn did not heartbeat its own lease.
   **Code on `main` now renews the lease on turn progress.** That is not a live
   acceptance. Do not treat the code change as proof the failure is gone.

Neither was a missing security control. Both were overshoot. The remaining proof
is a real VM run.

## Sprint C: capability calibration — code on `main`, live acceptance open

Purpose: let agents do reversible work without a babysitter, and let healthy
action turns finish.

Done when: an agent completes one real, reversible multi-step task on the Local
VM end to end, unattended, with no spurious approval wall and no mid-turn lease
abort, and every existing security boundary test still passes.

## Verification policy

- Run focused tests for the behavior changed.
- Typecheck when TypeScript contracts change.
- One brief smoke check for visible workflow changes.
- One negative check when a security boundary changes.
- Record anything not observed as unverified.

CI (macOS, Ubuntu, Windows tests; Linux package smoke; gitleaks; dependency
review on public PRs) runs on every pull request. A green PR is not a signed
release, a recovery test, or Local VM live acceptance.

## Remaining sprints (reconciled)

Built substrate — formalize or extend only as real needs appear:

| Sprint | Focus | Status |
|---|---|---|
| 1 | Domain model and run ledger | Append-only NDJSON event log + Store + redaction exist. Deferred: a typed turn-grained ledger record correlating context, cost, and outcome, plus retention/export. |
| 4 | Tools, permissions, approvals, security | Substantially built and tested. Sprint C recalibrates it; live VM proof remains. |
| 7 | Scheduling and autonomous runs | Routines and webhooks exist. Revisit truthful completion states after live VM acceptance. |

Still ahead:

| Sprint | Focus | Done when |
|---|---|---|
| 2 | Instruction stack and natural-language policy | Precedence is predictable; material ambiguity does not silently expand authority. |
| 3 | Models, capabilities, and assets | One agent changes providers without changing identity, and scoped assets do not leak between contexts. |
| 5 | Web and security monitoring | Approved targets produce meaningful changed findings without noisy output or credential exposure. |
| 6 | Rooms and collaboration | Specialists retain distinct instructions and share only authorized context and evidence. |
| 8 | Life OS and Jinx Memory APIs | **Cancelled.** Jinx stays on Discord; Harbor will not add those APIs to complete the control plane. |
| 9 | Execution-environment adapters | Local and VM implementations satisfy the same Harbor-owned lifecycle and security contract. |
| 10 | Personal reliability, recovery, and continuity | The owner can start a known-good checkpoint, back up `~/.openmausbot`, restore it, and roll back without losing required private data. |

## Immediate sequence

1. **Land the public docs PR** ([#30](https://github.com/LauraFlorey/agent-harbor/pull/30)) so `main` matches the public-source, Discord/Jinx, and clone/install story.
2. **Local VM live acceptance** (Sprint C remainder): one real reversible task, no spurious approval wall, no mid-turn lease abort.
3. **Owner backup/restore** of `~/.openmausbot` (Sprint 10 slice). Discord is where Jinx lives; Harbor still needs recoverable *agent* state.
4. Only then formalize the turn-grained run ledger (Sprint 1 remainder); retention and export follow as a separate pass.
5. Preserve a known-good personal checkpoint before replacing a working installation. A GitHub Release with binaries waits on signing — see [release-readiness.md](docs/release-readiness.md).

## Standing boundaries

- Capability and controls advance together; neither ships alone, and controls are
  calibrated to the real risk of the action, not to keyword coincidence.
- One security-sensitive story at a time.
- Jinx works with Laura on Discord. Harbor does not add a Discord bot, Jinx Memory
  API, or Life OS integration unless a new explicit decision names them. The in-app
  Chief of Staff is a generic local coordinator, not Jinx.
- Live client systems and later sprints remain out of scope unless the active story
  names them.
- Prepared, committed, pushed, merged, packaged, installed, recovery-tested, and
  live-accepted are different states.
- Public **source** is on GitHub. Signed installers, automatic updates, and a
  GitHub Release with binaries still need an explicit decision. A merged PR is
  not that release.
