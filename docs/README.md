# Documentation

Updated September 7, 2026. Use current guides for behavior; dated design records
explain earlier decisions and may describe features that have since changed.

## Current guides

| Document | Purpose |
|---|---|
| [Project overview](../README.md) | Capabilities, privacy and source startup |
| [Using Agent Harbor](using-agent-harbor.md) | Everyday conversations, Jinx, files, pictures and emoji |
| [Local work and model connections](local-work.md) | Local inference, Obsidian, actions and standing permissions |
| [Jinx connection](jinx-connection.md) | Mini bridge, memory receipts and teammate coordination |
| [Attachments](attachments.md) | Formats, media interpretation, privacy and limits |
| [OpenRouter](openrouter.md) | Setup, ordinary action tools and the separate Local VM route |
| [Voice](voice-mode.md) | Speech, dictation, calls and local-model restrictions |
| [OpenCode Go](opencode-go.md) | Optional ACP engine setup |
| [Security](../SECURITY.md) | Current authority and data boundaries |
| [Installation and recovery](deployment.md) | Source runtime, package verification and backup scope |
| [Ubuntu Desktop](linux-desktop.md) | Platform baseline and packaging reference; recent changes need platform acceptance |
| [Current handoff](plans/current-handoff.md) | Dated implementation, validation and promotion state |
| [Vision](../VISION.md) / [Architecture](../ARCHITECTURE.md) / [Roadmap](../ROADMAP.md) | Direction, present structure and future work |

## Historical and scoped records

- [Sprint 0 baseline](sprint-0-baseline.md): August 30 architecture inventory; not current capability status.
- [OpenRouter Local VM plan](plans/openrouter-local-vm-tool-loop.md): scoped acceptance plan, still incomplete; does not govern the separate general action path.
- [Computer-use design](computer-use-integration.md): August 12 host/browser design decisions.
- [OpenCode Go plan](plans/opencode-go-integration.md), [design](superpowers/specs/2026-08-15-opencode-go-integration-design.md) and [implementation plan](superpowers/plans/2026-08-15-opencode-go-integration.md): dated integration records.
- [Brand identity](brand-identity.md) and [rebrand boundary](agent-harbor-rebrand.md): visual/reference and compatibility decisions.

When behavior changes, update the relevant guide and the handoff. Update the
roadmap when completion or next priorities change. Record the date, platform and
verification scope; a healthy server, successful build, committed change and
installed package are separate observations. Keep old evidence dated rather
than presenting it as a fresh test result.
