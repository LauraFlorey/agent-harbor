# Public release checklist

Source publication and installer distribution are **separate**. The GitHub
repository is already **public**. This file is the remaining gate list, not a
claim that signed installers exist.

## Source (done)

- Repository visibility is public: [LauraFlorey/agent-harbor](https://github.com/LauraFlorey/agent-harbor).
- Default branch is `main`. CI runs on pull requests and on `main`.
- MIT license and OpenMausBot attribution are in [LICENSE](../LICENSE).
- Supported tester path is clone + `pnpm install --frozen-lockfile` + `pnpm dev:all`.

## Still verify on GitHub (account settings)

These are not proven by source files. Confirm in the GitHub UI:

- Private vulnerability reporting (Security Advisories) and a working owner contact in [SECURITY.md](../SECURITY.md).
- Default-branch protection or rulesets: required CI, no force-push to `main`.
- Secret scanning, push protection, and dependency alerts as the plan allows.

## Before distributing installers (not started)

- Build from an approved `main` (or tag) commit using frozen dependencies; record the commit, version, checksums, and CI run.
- On macOS, sign with the intended Developer ID, notarize, staple, and verify the installed app and helpers on a clean machine.
- On Windows, establish the signing identity, sign the installer/application, verify publisher identity, and test installation/uninstallation on a clean Windows machine.
- On Linux, verify package checksums, required system dependencies, installation, and sandbox behavior on a clean supported distribution.
- Test normal startup, authenticated API/SSE, reconnect, permissions, provider startup, and shutdown outside the checkout, without developer node_modules or credentials.
- Establish signed update verification, publisher continuity, and rollback before enabling the updater bridge. Automatic updates remain disabled in the source until this is completed.
- Publish a GitHub Release only for that signed (or explicitly labeled unsigned-test) artifact. A merged PR is not a release.

Signing credentials, Apple notarization, Windows publisher identity, and GitHub settings must be verified in their actual environments. None of them is established merely by changing source files or passing local tests.

Do not tell testers to disable Gatekeeper, SmartScreen, or Smart App Control in order to participate.
