# Agent Harbor rebrand boundary

Agent Harbor is the visible product and repository identity of this OpenMausBot-based fork. The first rebrand
changes names people see while deliberately preserving identifiers that already own data, credentials,
permissions, or protocol compatibility.

## Changed in the first rebrand

- app, window, onboarding, update, error, permission, and agent-facing copy
- Agent Harbor's beacon-and-harbor product mark and native application icons
- package name, product name, installer names, Linux executable, and desktop display name
- native speech helper display name and packaged bundle filename
- repository metadata, source-build instructions, and current user documentation
- release-feed ownership, so Agent Harbor builds cannot update from the upstream OpenMausBot channel

## Retained compatibility identifiers

| Identifier | Why it remains stable |
|---|---|
| `~/.openmausbot` | Existing bots, transcripts, configuration, logs, and fallback secret storage live here. |
| `OMB_*` | Existing development, deployment, smoke-test, and helper configuration uses this environment namespace. |
| `com.openmausbot.app` and `com.openmausbot.app.desktop` | Changing application identity can reset OS permissions, desktop integration, and installed-app continuity. |
| `com.openmausbot.app.secrets` | Existing macOS Keychain credentials are stored under this service. |
| `openmausbot` health, RPC, MCP, socket, container, profile, and helper names | These are machine-facing compatibility keys, not display copy. |

These retained strings are intentional and covered by tests or package verification. Rename them only in a
dedicated migration that proves old data, Keychain items, macOS privacy grants, Linux desktop integration,
container state, remote helpers, and existing configuration continue to work.

## Upstream relationship

The `upstream` Git remote remains fetch-only and points to OpenMausBot. Agent Harbor preserves the upstream MIT
license and attribution. Rebrand commits should stay focused so future upstream changes can still be reviewed
and merged without mixing product identity with unrelated feature work.

The visual system and asset sources are documented in [brand-identity.md](brand-identity.md).
