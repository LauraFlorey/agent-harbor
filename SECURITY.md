# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting
for this repository when enabled. If private reporting is unavailable, contact the repository owner privately
before sharing exploit details.

## Scope notes for researchers

- The harness server binds **127.0.0.1 only**. Workspace API calls and SSE require a per-server
  bearer credential, stored in an owner-private session file and delivered to the desktop only through
  validated main-frame IPC. Only static UI and the minimal health endpoint are public. Exact Host and
  UI Origin checks are additional controls; loopback alone is not authentication. Agent-internal routes
  use a separate credential and reject browser origins. Do not expose either listener through a general proxy.
- API keys live in macOS Keychain (or the mode-`0600` `~/.openmausbot/secrets.json` fallback on
  Windows/Linux) and are write-only through the API (`configured` booleans out, never values).
  `config.json` must contain non-secret settings only. Any path that echoes a stored secret back —
  API response, SSE event, log line, argv visible in `ps` — is a vulnerability.
- Agents run real CLIs (`claude`, `codex`) with the user's own privileges, and the permission broker
  is the consent layer for risky actions. Bypasses of the broker (approving without a user decision,
  spoofing the broker socket) are vulnerabilities.
- Agent and container subprocesses start from a small operating-system environment allowlist rather
  than inheriting the harness environment. Provider credentials and helper configuration must be
  supplied explicitly for the subprocess that needs them. Accidental inheritance of unrelated
  provider keys, database URLs, deployment tokens, or loader-injection variables is a vulnerability.
- Local agent turns start in a private per-bot workspace, and legacy bots with no computer choice
  fail closed as `off`. Starting in the user's home folder or attaching the host desktop requires a
  separate per-bot opt-in. Provider sandboxes and the permission broker remain the enforcement layer
  for operations outside the working directory; a working directory alone is not an OS sandbox.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.
- The experimental OpenRouter Local VM loop is a narrow application-owned
  exception to OpenRouter's provider-wide `computerUse: "none"` declaration.
  It requires both default-off owner controls, the exact source-controlled
  `openai/gpt-5.6-terra` ID, current account metadata, a direct conversation,
  an explicit Local VM destination, and a ready isolated VM. Metadata can
  revoke but never grant authority beyond that exact manifest entry.
- OpenRouter Local VM routine authorization covers only known, no-argument observation tools
  for the attended task. Shell execution, clicks, typing, parameterized/unknown tools, and ambiguous
  effects require a fresh decision for each attempt. Keyword detection may make a decision stricter,
  but can never grant authority. Prompts, provider responses, MCP servers, and cloned approval data
  are not approval authorities. Approval displays and observability must remain
  bounded and must redact protected inputs, credentials, raw call IDs, endpoint
  details, provider bodies, and tool arguments/results.
- The OpenRouter Local VM turn owns one exclusive lease through provider
  streaming, approvals, MCP execution, continuation, child-process cleanup,
  and release. It must never route to the host, cloud computer, connected apps,
  files, dweb, peer agents, a host working directory, or a fallback destination.
  Disabling the global switch must cancel and drain active turns without
  changing stored agent, model, room, or ordinary text-chat settings.

## Release boundaries

No analytics SDK or automatic usage/email reporting ships in the app. Public API ingestion keys
found in older history are not account secrets; any scanner exception must name the exact reviewed finding.

Automatic installer updates are disabled until signing and update provenance are verified. See
[release-readiness.md](docs/release-readiness.md). Source builds are experimental. Same-OS-user
processes with unrestricted filesystem or Keychain access are outside the isolation provided by an
API credential; provider sandboxes and separate OS/container boundaries remain necessary.
