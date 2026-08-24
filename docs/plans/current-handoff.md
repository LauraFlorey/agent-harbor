# Agent Harbor current handoff

Status recorded: August 24, 2026, approximately 11:10 AM CDT

## Executive status

Issue #11 Stories 1–6 are implemented as separate checkpoints and pushed to
private branches. They are not merged into `main`.

The earlier MCP-startup blocker has been repaired at diagnostic checkpoint
`cf11c7c`. Controlled live acceptance now proves the OpenRouter Terra,
application-owned Allow once, turn-scoped MCP, isolated Local VM, read-only
browser inspection, final-response, lease-release, and cleanup path.

The remaining blocker is narrower: approved browser actions fail after
read-only inspection succeeds. Both a visual click and Cua's declared
`page` / `click_element` action with the exact harmless fixture selector failed.
The fixture did not change, the Local VM remained healthy, and cleanup passed.
The feature is therefore implemented but not accepted for release.

OpenRouter Spawn was evaluated separately and deferred. The model-picker scroll
repair is complete on its own branch. Barehands is a separate external demo
experiment and is not integrated with Agent Harbor.

## Current branches and checkpoints

| Work | Branch | Current checkpoint | State |
|---|---|---|---|
| Story 6 product baseline | `codex/issue-11-story-6-product-integration` | `3d40a87` | Pushed; unmerged |
| MCP diagnostics and acceptance repair | `codex/issue-11-mcp-startup-diagnostics` | `97c7218` before this documentation update | Pushed; unmerged |
| Model-picker mouse-wheel scrolling | `codex/model-picker-scroll-fix` | `83ddc26` | Pushed; unmerged; user validated |
| Default branch | `main` | `3b5e23b` | Separate from Issue #11 work |

There are no open pull requests. The private remote is
`LauraFlorey/agent-harbor`; the public `milind-soni/OpenMausBot` remote remains
fetch-only with pushing disabled.

## Live acceptance record

### Passed

- The exact `openai/gpt-5.6-terra` test agent used the isolated Local VM.
- A fresh Allow once decision authorized `get_accessibility_tree`.
- Terra described the visible desktop correctly.
- The controlled loopback-only fixture was reachable through Docker Desktop's
  private host bridge.
- Terra returned the correct fixture title, heading, and `Status: ready`.
- The Local VM lease was released and no MCP guardian remained.
- The final branch review passed 77 test files, with 709 tests passing and 8
  skipped; 12 updater tests, type checking, secret checks, and the production
  build also passed. The build emitted only the existing large-chunk warning.

### Not passed

- An approved visual click missed the harmless fixture button.
- An independently approved `page` / `click_element` call using
  `#harmless-button` returned a Local VM action failure.
- Scroll, typing, interruption, rollback, package smoke, release, and support
  claims have not been accepted on this path.

Issue [#16](https://github.com/LauraFlorey/agent-harbor/issues/16) owns the next
diagnostic step. Its scope is to reproduce one harmless click, compare each
provider/approval/MCP/Cua boundary, and add a failing regression test at the
lowest failing layer. It must end with a reviewed repair proposal or an
evidence-backed external-dependency block, not an unreviewed implementation.

## OpenRouter Spawn status

A time-boxed Spawn `v1.1.1` Local Sandbox proof ran outside Agent Harbor. It
provisioned no cloud resource, exposed no Agent Harbor or Jinx files, completed
no model prompt, and recorded `$0.000` usage.

The proof found an obsolete Codex invocation, a dry-run/headless dispatch
problem, forced-TTY behavior, and a false success exit status after prompt
failure. Spawn is deferred until a newer release fixes those boundaries.

Cleanup is complete: the one-day POC key was revoked, its local credential file
is absent, the approximately 1.1 GB Spawn Codex Docker image was removed, and
no Spawn container or process remains. Spawn and Bun remain installed for a
future re-evaluation; no Agent Harbor adapter is authorized.

## Model-picker repair

The model selection panel's mouse-wheel scrolling defect is fixed on
`codex/model-picker-scroll-fix`. The change limits the picker height and gives
the provider and model areas independent scrolling. The user verified real
mouse-wheel behavior, the production build passed, and the branch is pushed to
the private remote. It remains separate and unmerged.

## Separate Barehands demonstration

Barehands is installed in a sibling local demo checkout, not this repository.
It is pinned to upstream commit
`bdd8df505b290287dc5483844eb43d61fa1b74af`, has public pushing disabled, and
uses only included sample notes and media. Its local server binds to
`127.0.0.1:8794`; Chrome loaded MediaPipe successfully and the camera feed
reached 1920 x 1080 readiness without capturing or inspecting webcam imagery.

A separate user-triggered helper places one harmless card describing a possible
future companion interface. There is no agent connection, model call, Cua
route, personal-note access, credential access, or Agent Harbor source change.
The current interaction quality is early-stage, and no Barehands source patch
has been made. Any future display-only bridge requires its own scope, security
review, and AGPL licensing decision.

## Runtime observed at this handoff

This is a dated observation, not a promise of future readiness:

- Agent Harbor harness: HTTP 200 on `127.0.0.1:8799`
- Webhook receiver: listening on `127.0.0.1:8800`
- Interface: HTTP 200 on `127.0.0.1:5199`
- Local VM preview: HTTP 200 on `127.0.0.1:6080`
- `openmausbot-computer`: running, healthy, not restarting, not OOM-killed
- Barehands demo: listening separately on `127.0.0.1:8794`
- Agent Harbor repository: clean before this documentation update
- Barehands source checkout: clean on its pinned demo branch
- A historical read-only process/socket monitor from the August 23 acceptance
  preparation remains active and appends to its preserved `/tmp` evidence log.
  It was not stopped during this documentation pass; identify its exact process
  tree and obtain separate approval before cleanup.

Recheck all runtime facts before restarting, cleaning, testing, or claiming
readiness. Do not infer live acceptance from healthy ports or containers.

## Boundaries preserved

- Jinx remains separate and was not queried, modified, or integrated.
- Barehands and Spawn remain outside Agent Harbor.
- No credentials, API keys, raw screenshots, approval capabilities, or provider
  bodies were added to source or documentation.
- No Docker pruning, Local VM recreation, cloud provisioning, release,
  deployment, merge, or pull request occurred during this update.
- Existing rooms, providers, models, destinations, approvals, leases, cleanup,
  and audit controls were not weakened.

## Next decision

1. Keep Issue #11 controlled acceptance paused.
2. Use Issue #16 for diagnosis only; do not implement a fix until the failing
   boundary and regression test are reviewed.
3. Keep Spawn deferred and Barehands external.
4. Review the model-picker branch independently for merge when desired.
5. Resume the remaining Issue #11 acceptance sequence only after the approved
   browser-action defect has a reviewed disposition.
