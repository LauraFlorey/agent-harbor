# Public release checklist

This is a release gate, not a claim that a release has occurred. Source publication and installer distribution are separate decisions.

## Before changing repository visibility

- Select and review the exact default-branch commit. Include approved work from feature branches deliberately.
- Run lint, typecheck, tests, dependency audit, source/history secret scanning, and clean builds on that commit.
- Inspect all remote branches, tags, historical documents/images, PR or issue attachments, Actions artifacts, and releases for private material. Scan credentials before any history cleanup; rotate a real exposed credential if one is found.
- Confirm the MIT attribution and documentation, remove obsolete public screenshots from displayed pages, and keep local data and credentials outside Git.
- Enable private vulnerability reporting and confirm the contact path in SECURITY.md works. If unavailable, establish a working private contact before publication.
- Configure default-branch protection or rulesets with required CI/security checks, review, and restrictions on force pushes. Availability depends on the account plan and repository visibility; do not assume a failed settings lookup means protection is enabled.
- Enable the available GitHub secret-scanning/push-protection and dependency security features. Public dependency review is configured in CI; the package audit and Gitleaks checks also run while private.
- Change visibility only after owner approval, then verify the public view and settings.

## Before distributing installers

- Build from the approved commit using frozen dependencies; record the commit, version, checksums, and CI run.
- On macOS, sign with the intended Developer ID, notarize, staple, and verify the installed app and helpers on a clean machine.
- On Windows, establish the signing identity, sign the installer/application, verify publisher identity, and test installation/uninstallation on a clean Windows machine.
- On Linux, verify package checksums, required system dependencies, installation, and sandbox behavior on a clean supported distribution.
- Test normal startup, authenticated API/SSE, reconnect, permissions, provider startup, and shutdown outside the checkout, without developer node_modules or credentials.
- Establish signed update verification, publisher continuity, and rollback before enabling the updater bridge. Automatic updates remain disabled in the source until this is completed.

Signing credentials, Apple notarization, Windows publisher identity, and GitHub settings must be verified in their actual environments. None of them is established merely by changing source files or passing local tests.
