# Current handoff

Updated August 30, 2026 after confirming the private personal-product scope.

## Executive status

- **Repository:** `/Users/lauraflorey/projects/agent-harbor`
- **Current branch:** `codex/personal-action-capabilities`
- **Current implementation commit:**
  `29a679a82dc4226c152dee87f6f3aad4adea9ede`
- **Documentation commit:**
  `4403d90ef5ac080e47bf1781e7077f00d1be00f8`
- **Documentation state:** the August 30 personal-scope revisions are prepared
  locally and intentionally uncommitted. They now include repository-native
  `VISION.md`, `ARCHITECTURE.md`, and `ROADMAP.md` documents.
- **Remote state:** the branch is pushed and tracks
  `origin/codex/personal-action-capabilities`. `origin/main` remains at
  `3b5e23b2be95b1952e09b260f385a890d1610c53`.
- **Working tree baseline:** clean except for the pre-existing untracked
  `.agents/` owner directory before this scope-documentation update.
- **Runtime state:** the last verified unified development runtime used
  `29a679a` on August 29. It was not restarted or re-accepted for this scope update.
- **Promotion state:** not merged into private `main`, packaged for personal
  installation, installed as a promoted checkpoint, or recovery-tested.
- **Product scope:** Agent Harbor is for Laura's private personal use. No public
  or open-source Agent Harbor release is currently planned.

The pre-existing untracked `.agents/` directory is owner material and is not
part of the current change. In particular, its Windows release skill must not
be modified or included accidentally.

## What is implemented

The current branch contains the complete Issue #11 Story 1–6 history, the
Local VM acceptance repair, the model-picker mouse-wheel scroll fix, and the
personal-use capability simplification.

The latest checkpoint adds:

- bounded provider-hosted web research to OpenRouter turns without granting a
  computer destination: at most 4 searches, 5 results per search, 12 results
  total, and low search context;
- one application-owned routine-action approval for an attended Local VM task,
  while consequential actions still require a fresh one-attempt approval;
- longer fixed monotonic limits: 20 minutes per turn, 10 minutes for approval,
  90 seconds per tool call beginning after approval, 20 seconds per MCP
  request, and 30 seconds per execution;
- independent owner-authored system instructions for every agent, bounded to
  20,000 characters and used in direct conversations and multi-agent rooms
  without changing that agent's provider, model, connected apps, permissions,
  or computer destination; and
- the model-picker mode-list mouse scroll repair from parent commit `83ddc268`.

No existing provider, room, multi-agent behavior, connected app, permission,
or host/cloud destination was removed or narrowed. OpenRouter's exact Terra
allowlist controls only the new Local VM loop; other available OpenRouter
models remain usable for ordinary text chat and bounded web research.

## Verification attached to `29a679a`

- focused capability tests: 156 passed;
- full suite: 78 files, 722 passed, 8 skipped;
- updater tests: 12 passed;
- type checking: passed;
- production build: passed;
- Electron syntax checks: passed; and
- diff-integrity, generated-artifact, and secret scans: passed.

The development runtime was restarted after those checks through
`pnpm dev:all`. At 13:05 CDT on August 29, the harness and webhook health
endpoints responded successfully, the interface returned HTTP 200, the
Electron GPU/network/renderer helpers were present, and no `mcp-guardian.ts`
or startup cascade appeared. The preserved launcher log is:

`/tmp/agent-harbor-dev-20260829T130028-0500.log`

That is a local source-runtime baseline, not personal-installation or recovery evidence.

## Live acceptance state

An earlier controlled Story 6 run at checkpoint `cf11c7c` proved one complete
approval-gated Local VM tool path: Terra requested a discovered tool, Laura
approved the request, the tool ran inside the isolated Local VM, and the model
returned a final description. The broader screenshot, controlled-page click,
scroll, typing, consequential-action, interruption, restart-cleanup, Computer
Off, and global-switch rollback sequence remains incomplete.

After later model changes, the product also displayed **“Local VM lease ended
before the turn completed.”** That failure has not been resolved or reproduced
against `29a679a`. Do not treat the longer limits or approval-policy change as
proof that the lease problem is fixed.

The new OpenRouter web-research request shape, the updated routine-task
approval flow, and per-agent system instructions have automated coverage and a
healthy core runtime. No live credentialed OpenRouter request or complete
post-change Local VM acceptance run was made as part of this documentation
refresh.

Docker and the Local VM were not inspected or modified during this refresh, so
their present state is deliberately unverified. Jinx was not accessed and
remains completely outside this repository and handoff.

## Known boundaries

- The OpenRouter Local VM feature is globally off by default and independently
  off for each agent by default.
- Only exact `openai/gpt-5.6-terra`, confirmed by current account metadata, can
  enter the new OpenRouter Local VM loop.
- The new loop is initially direct-agent only. Existing multi-agent rooms and
  their ordinary provider behavior remain available.
- Web research is provider-hosted and does not grant Local VM, host Mac, cloud
  computer, connected-app, file, peer-agent, credential, or environment
  access.
- System instructions are prompt context, not approval or execution authority.
- Passwords, MFA, CAPTCHAs, and other protected input stay manual in the
  visible destination and must not be put into chat.

## Current product direction

Agent Harbor is the private control plane for Laura's agents, permissions,
tools, environments, collaboration, approvals, and run evidence. Life OS and
the Jinx Memory System remain separate applications that may integrate through
explicit APIs and events. Jinx may be the Chief of Staff personality across
the ecosystem, but neither Jinx nor Life OS may bypass Harbor's policy engine.

Public branding, contributor onboarding, generalized support promises, public
release signing, and open-source launch work are indefinitely deferred unless
Laura explicitly revives that goal. Upstream MIT attribution remains intact.

## Safest next step

1. Run one controlled, non-sensitive acceptance sequence against the exact
   pushed commit. Start with bounded OpenRouter web research, verify system
   instructions in a direct conversation and a room, and only then prepare the
   isolated Local VM and test one routine task.
2. If the lease error recurs, preserve the first error and lifecycle evidence
   and diagnose it before retrying or broadening access.
3. Review the completed acceptance evidence and explicitly decide whether to
   merge the branch into private `main`. Do not replace Laura's working build
   merely because the automated suite passed.
4. Keep `VISION.md`, `ARCHITECTURE.md`, and `ROADMAP.md` synchronized as the
   personal system changes; do not let public-product or premature vendor
   experiments re-enter the active plan without Laura's explicit decision.

The private installation gates are in [Private installation, packaging, and recovery](../deployment.md),
and the remaining Local VM acceptance sequence is in
[OpenRouter Local VM tool loop](openrouter-local-vm-tool-loop.md).
