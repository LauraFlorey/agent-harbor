# Agent Harbor roadmap

Status: private personal roadmap — revision 0.4, reconciled against the actual codebase on August 30, 2026.

## Current checkpoint

- Sprint C landed and verified (Aug 30 2026): the lease heartbeat (Story 1) and the consequential-gate recalibration plus redacted decision log (Story 2) are implemented, and the full suite is green (733 passed, 8 skipped across 78 files; updater 12/12). Changes are staged for commit on this branch. Remaining for Sprint C: the live end-to-end acceptance run on the Local VM, then a merge decision.

- Full suite green on Laura's machine (Node 26.7.0): typecheck clean, 722 passed /
  8 skipped across 78 test files, updater checks 12/12.
- Active branch `codex/personal-action-capabilities` at documentation checkpoint
  `4403d90`, pushed, not merged into private `main`. Implementation checkpoint `29a679a`.
- The security substrate is built and tested: approval integrity (no self-approval,
  replay/tamper/cross-turn rejection, monotonic expiry, fail-closed), unlinkable
  per-turn capabilities, lease ownership, circuit breakers, delegation ceilings, peer
  approval, redaction, secret store, an append-only per-thread event log, atomic
  persistence, branching/versioning, plus routines and webhooks.
- The starved axis is capability. The controlled Local VM browser-action sequence
  (click, scroll, type, interruption, cleanup, Computer Off, rollback) is still
  unaccepted, and two mechanisms currently choke real action — see the Sprint 0
  finding below.
- Life OS and Jinx Memory remain separate and unchanged. No public or open-source
  release is planned.

## Sprint 0 finding: the problem is capability, not controls

Reconciliation verdict: the codebase is well ahead of the prior roadmap. Sprint 1
(run ledger), Sprint 4 (permissions/approvals/security), and Sprint 7 (scheduling)
are substantially built and covered by the passing suite. What is not working is
agents doing useful multi-step work — they can largely only chat. Two specific
mechanisms cause it:

1. Over-broad consequential gate. `tool-approval.ts` flags a call "consequential"
   when the tool name or its free-text arguments match crude patterns —
   `HIGH_IMPACT = /account|credential|delete|message|password|publish|purchase|secret|token/i`
   tested against the entire canonical argument JSON, plus `looksDestructive` /
   `looksSensitive` from `auto-approve.ts`. Because ordinary arguments routinely
   contain words like "message" or "account," a large share of benign, reversible
   actions get flagged. Consequential actions are hard-refused in unattended/routine
   mode (`local-vm-routine-authorization.ts`) and always require approval when
   attended. Net effect: constant approval walls or outright refusal.

2. Lease expiry mid-turn. The Local VM lease is renewable (`LocalVmLease.touch`), but
   `runLocalVmToolTurn` does not heartbeat its own lease — renewal depends on
   external event-driven `touch()` calls. A turn with a long provider or tool wait
   outlives the TTL and is cancelled with "Local VM lease ended before the turn
   completed," the unresolved error from the prior checkpoint.

Neither is a security flaw; both are security overshoot. The fix is calibration,
not removal.

## Sprint C: capability calibration — landed Aug 30 2026, pending live acceptance

Purpose: let agents do reversible work without a babysitter, and let healthy action
turns finish.

- Reclassify "consequential" by the tool's declared effect, not a free-text argument
  keyword scan. Reversible actions (read, navigate, scroll, click a non-destructive
  control, type into a form field) run under active policy without a challenge.
  Reserve human-only challenges for genuinely irreversible or high-authority effects:
  publishing, spending, credential or permission changes, destructive writes, and
  private-data egress. Honor the existing risk ladder (routine + reversible =
  automatic).
- Heartbeat the Local VM lease from the turn's own progress so a long but healthy
  turn cannot expire mid-action; keep fail-closed behavior for a genuinely lost lease.
- Preserve every existing negative-security test; add positive tests that prove an
  agent completes a real multi-step task.

Done when: an agent completes one real, reversible multi-step task on the Local VM
end to end, unattended, with no spurious approval wall and no mid-turn lease abort,
and every existing security boundary test still passes.

## Personal verification policy

Testing stays short and proportional to Laura's personal use:

- run focused tests for the behavior changed;
- run type checking when TypeScript contracts change;
- perform one brief manual smoke check for visible workflow changes;
- add one negative check when a security boundary changes; and
- record anything not observed as unverified.

The full suite remains useful before merging a large or cross-cutting change, but
every small personal iteration does not need a public-release test matrix. Real use
will reveal ordinary product bugs; authority, privacy, credential, destructive-action,
and recovery boundaries still require deliberate checks.

## Remaining sprints (reconciled)

Built substrate — formalize or extend only as real needs appear:

| Sprint | Focus | Status |
|---|---|---|
| 1 | Domain model and run ledger | Append-only NDJSON event log + Store + redaction exist. Deferred: a typed turn-grained ledger record correlating context, cost, and outcome, plus retention/export. |
| 4 | Tools, permissions, approvals, security | Substantially built and tested. Sprint C recalibrates it. |
| 7 | Scheduling and autonomous runs | Routines and webhooks exist. Revisit truthful completion states after Sprint C. |

Still ahead:

| Sprint | Focus | Done when |
|---|---|---|
| 2 | Instruction stack and natural-language policy | Precedence is predictable; material ambiguity does not silently expand authority. |
| 3 | Models, capabilities, and assets | One agent changes providers without changing identity, and scoped assets do not leak between contexts. |
| 5 | Web and security monitoring | Approved targets produce meaningful changed findings without noisy output or credential exposure. |
| 6 | Rooms and collaboration | Specialists retain distinct instructions and share only authorized context and evidence. |
| 8 | Life OS and Jinx Memory APIs | A narrow end-to-end flow works while every application also remains operable alone. |
| 9 | Execution-environment adapters | Local and VM implementations satisfy the same Harbor-owned lifecycle and security contract. |
| 10 | Personal reliability, recovery, and continuity | Laura can install or start a known-good checkpoint, back up required state, restore it, and roll back without losing required private data. |

## Immediate sequence

1. Land Sprint C: recalibrate the consequential gate and heartbeat the lease, guarded
   by the existing security suite plus one new "agent completed a real task" check.
2. Run one controlled, non-sensitive end-to-end Local VM task as the acceptance evidence.
3. Only then formalize the turn-grained run ledger (Sprint 1 remainder); retention and
   export follow as a separate pass.
4. Decide explicitly whether the branch merges into private `main`.
5. Preserve a known-good personal checkpoint before replacing the working installation.

## Standing boundaries

- Capability and controls advance together; neither ships alone, and controls are
  calibrated to the real risk of the action, not to keyword coincidence.
- One security-sensitive story at a time.
- Jinx, Life OS, live client systems, and later sprints remain out of scope unless the
  active story names them.
- Prepared, committed, pushed, merged, packaged, installed, recovery-tested, and
  live-accepted are different states.
- Public-release work does not resume without a new explicit product decision.
