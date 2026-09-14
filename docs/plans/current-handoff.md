# Current handoff

Updated for public source version **0.1.21**.

## Executive status

- **Repository:** public — [github.com/LauraFlorey/agent-harbor](https://github.com/LauraFlorey/agent-harbor)
- **Default branch:** `main` at `d92dd96` (PR #28, 2026-09-05)
- **Open docs PR:** `cursor/compare-librechat-2ab7` /
  [PR #30](https://github.com/LauraFlorey/agent-harbor/pull/30) — README, install,
  screenshots, Jinx/Discord boundary, research notes. Not merged.
- **Product:** local-first agent control plane. Source clone is the supported
  beta path. No GitHub Releases. No signed installers. Automatic updates off.
- **Jinx** works with Laura on Discord, not in this app. No Jinx Memory API,
  Discord gateway, or reserved bot named Jinx. In-app Chief of Staff is a
  generic local coordinator.
- **Sprint C code is on `main`** (lease heartbeat, consequential-gate work).
  **Live Local VM acceptance is not done.**
- **Backup/restore** of `~/.openmausbot` is not done.

Do not follow the August 30 branch name `codex/personal-action-capabilities` as
the active line of work. That history is already on `main`.

## What is implemented (on `main`)

- Bots, rooms, tasks, model selection, approvals, routines, webhooks
- Per-agent computer destinations: off / Local VM / this computer / cloud Box
- Bounded OpenRouter web research without granting a computer destination
- Attended Local VM routine-action grant; consequential actions still pause
- Turn limits in `server/tool-turn-control.ts`; exclusive VM lease with renewal
  on turn progress
- Per-agent system instructions (bounded, prompt context only)
- Public-source hardening: loopback bearer, no analytics SDK, gitleaks, audit,
  disabled updater

## Live acceptance state

An earlier controlled run at `cf11c7c` proved one approval-gated Local VM tool
path. The broader screenshot, click, scroll, typing, consequential-action,
interruption, cleanup, Computer Off, and rollback sequence remains incomplete.

The lease-ended-mid-turn failure was addressed **in code** by renewing the
lease from turn progress. That has **not** been re-proven on a live VM. Do not
treat tests as that proof.

Docker and the Local VM are unverified in this documentation refresh. Jinx is
out of band (Discord) and is never part of Harbor deploy or cleanup.

## Known boundaries

- OpenRouter Local VM is globally off and per-agent off by default.
- Only exact `openai/gpt-5.6-terra`, confirmed by current account metadata, can
  enter that loop.
- The loop is initially direct-agent only.
- Web research is provider-hosted and does not grant computer, file, peer, or
  credential access.
- System instructions are not approval authority.
- Passwords, MFA, and CAPTCHAs stay manual in the visible destination.

## Product direction

Harbor stays the control plane: agents, policy, computers, evidence. Discord
and a possible later Life OS must not bypass the policy engine. Public source
does not mean a support program or a signed desktop product.

## Safest next step

1. Merge or continue [PR #30](https://github.com/LauraFlorey/agent-harbor/pull/30)
   so `main` docs match the public repo.
2. Run one controlled, non-sensitive Local VM acceptance sequence against a
   known `main` (or post-merge) commit.
3. If the lease error recurs, keep the first error and lifecycle evidence
   before retrying.
4. Then owner backup/restore of `~/.openmausbot`.
5. Do not cut a GitHub Release with unsigned installers for reviewers.

Installation gates: [deployment.md](../deployment.md).
Local VM sequence: [openrouter-local-vm-tool-loop.md](openrouter-local-vm-tool-loop.md).
GitHub vs releases: [CONTRIBUTING.md](../../CONTRIBUTING.md).
