# Agent Harbor roadmap

Private personal roadmap, reconciled September 7, 2026. This describes priority
and completion, not a release announcement. Exact evidence lives in the
[current handoff](docs/plans/current-handoff.md).

## Current checkpoint

The app has moved beyond chat-only work. The local worktree now includes:

- General OpenRouter/Jinx direct-conversation tools for permitted notes, approved
  commands, supported connected apps, schedules and teammate coordination.
- A local-model connection with notes, schedules and attachment reading, no
  Harbor cloud fallback, and explicit local/cloud privacy boundaries.
- Jinx connected to the existing Mac Mini process and memory pipeline as Chief
  of Staff, with real teammate discovery and synchronous asking verified.
- Document, spreadsheet, PDF, image, audio and video attachments, with local
  extraction/transcription and optional model vision.
- Local profile pictures, emoji messaging and user-added reactions.
- Host-computer connection support and standing attended desktop permission.

These changes are in the source development app on Laura's Mac. HEAD remains
`4403d90` on `codex/personal-action-capabilities`; the newer implementation is
uncommitted. It is not a new installed package or published release.

## Next sequence

1. **Laura's trial:** use Jinx and the agents with everyday work; address observed
   friction or failures. Keep current documentation aligned with the behavior.
2. **Local voice privacy gap:** add equivalent local-model guards to group calls
   and bot-bound speech authorization on the server. Direct chat UI restrictions
   currently do not cover these paths; use direct text for private local work.
3. **Potential Grokbot migration, after the trial:** inspect available records and
   formats, preserve originals and a backup, agree what belongs in Harbor versus
   Jinx memory, then implement and verify the chosen import. No migration has
   happened, and no complete import compatibility is claimed.
4. **Personal checkpoint and recovery:** preserve the useful source changes in a
   reviewed checkpoint; verify attachment/native dependency packaging and backup
   restoration before replacing a known-good installation.
5. **Later remote access:** design authenticated access to a locally hosted Harbor
   over Tailscale. The current loopback app API is not a remotely authenticated
   service. This setup has not been built or configured.

## Remaining work by area

| Area | Existing capability | Remaining work |
|---|---|---|
| Domain and run evidence | Stored agents, transcripts, append-only events and redaction | Stable domain schema, versioned turn ledger, retention and export |
| Instructions and policy | Per-agent system instructions, tool gates and concrete approvals | Formal precedence, natural-language policy compilation, human-only high-risk challenges |
| Models and assets | Multiple providers, local inference and scoped attachment reader | Broader provider/platform acceptance, asset retention and lifecycle; local vision capability support beyond the current server shape |
| Permissions | Scoped text tools, exact remembered grants, scheduled-notes setting, attended desktop setting | Evaluate real task friction and authority boundaries; desktop standing consent is not per-click consequence review |
| Collaboration | Rooms, Chief of Staff, ask/delegate tools | Richer task/status visibility if wanted; API rooms currently lack the full direct-chat action tool set |
| Scheduling | Local routines and webhook receiver | Real-use completion/recovery evidence and always-on operation if requested |
| Web/security monitoring | Research and scheduling building blocks | Approved target workflows and meaningful change detection; no general monitoring service is claimed |
| Jinx and Life OS | Jinx bridge, memory staging, actual teammate replies | Life OS API flow and broader memory ownership/retrieval contracts |
| Environments | Host, cloud and experimental isolated Local VM adapters | Complete controlled Local VM action, interruption and recovery acceptance |
| Reliability | Source runtime and automated checks | Fresh-machine installation of recent features, backup/restore, rollback and continuity |

## Local VM calibration: implemented, acceptance unfinished

The August 30 investigation identified broad argument-keyword classification and
lease expiry during long turns as blockers. Effect-oriented calibration, a
redacted decision log and turn-owned lease heartbeat were subsequently added.
Those code changes do not prove the original live lease failure is resolved.

One earlier controlled run completed an approval-gated VM tool call. The complete
screenshot, click, scroll, type, interruption, cleanup, Computer Off and rollback
sequence still needs acceptance. Host-desktop and attachment success do not close
that gap. The [Local VM plan](docs/plans/openrouter-local-vm-tool-loop.md) retains
the controlled fixture and criteria; its dated checkpoints are historical.

## Verification and scope

Use focused checks for changed behavior, type checking when contracts change,
one brief UI smoke check for visible workflows, and negative checks when an
authority or privacy boundary changes. Broader checks are appropriate for a
cross-cutting checkpoint. Record source/runtime evidence separately from package,
installation, remote synchronization and recovery evidence.

No public-release work is planned. Jinx, Life OS and live external systems remain
separate systems; a Harbor change does not implicitly authorize changing them.
Keep the [vision](VISION.md) and [architecture](ARCHITECTURE.md) synchronized with
implemented behavior without presenting target architecture as already built.
