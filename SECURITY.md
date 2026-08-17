# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email **soni.mil2001@gmail.com** with
the details (or use GitHub's private vulnerability reporting on this repo if enabled). You'll get a
response as soon as possible, normally within a few days.

## Scope notes for researchers

- The harness server binds **127.0.0.1 only** and has no authentication by design — it trusts the
  local user. Anything that makes it reachable from off-machine, or lets one local *unprivileged
  other user* drive it, is a vulnerability.
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
