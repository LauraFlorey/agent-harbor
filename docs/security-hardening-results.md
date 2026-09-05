# Security hardening results

Prepared September 4, 2026. These changes prepare Agent Harbor for a separate public-source decision. They do not change repository visibility or establish a signed installer release.

## Preserving existing work

The work is on `codex/public-release-hardening` in a separate checkout. Commit `aee8f01` preserves the existing tracked changes and project documents before hardening. The original working directory and its running application were not changed. All 30 files in the original change manifest were independently checked against their saved hashes.

## Implemented

- **Workspace authentication:** the local API and event stream require a random credential that rotates on server restart. The server checks the exact host and allowed UI origin. Credentials are kept in a private local session file and in renderer memory, not URLs or browser storage. The desktop connects automatically; browser development uses `pnpm dev:access`.
- **Approval boundaries:** routine grants cover only recognized observation tools with empty arguments. Commands, coordinate actions, typing, unknown tools, and parameterized calls require individual approval. Regression tests cover a Python file-deletion command and coordinate click using stubs; no real deletion or click was performed.
- **Packaged dependencies:** the server bundles its Ajv validation dependency. An isolated import check runs outside the checkout, and Linux CI relocates the packaged application outside the development tree before launch.
- **Privacy:** removed the inherited analytics SDK, automatic tracking, and email identification. Onboarding email is optional and stored locally. This does not stop user-requested provider calls or integration traffic.
- **Request handling:** malformed request targets receive an error instead of crashing the server. JSON bodies must be objects and remain size limited. Configuration and approval inputs receive field validation. HTTP and configuration handling were extracted into focused modules.
- **Desktop boundaries:** privileged IPC requires an owned window and trusted main frame; navigation, embedded content, and permissions are restricted. Packaged pages receive a content security policy. The updater and its renderer bridge remain disabled pending verified signed releases. Unsigned installer artifacts are retained only while the repository is private.
- **Dependencies and maintenance:** patched the vulnerable URI/XML dependencies, added lint checks, removed tracked generated server output, pinned workflow actions, and added dependency updates, dependency audit, and history secret scanning.
- **Public documentation:** updated the README and security guidance, restored contribution/reporting templates, and added explicit source-publication and installer-distribution gates. Historical planning documents retain their context with a current-direction note.

## Verification

- Full tests: 82 test files pass, with 739 tests passed and 8 skipped; the separate updater suite passes all 12 tests. Total: 751 passed and 8 skipped.
- Lint, TypeScript, Electron/script syntax, production UI build, server build, and isolated server dependency check pass.
- The hidden desktop smoke test uses disposable data and no personal providers or computer-control service. It verified automatic authentication, rendered onboarding, authenticated live events, HTTP 401 for unauthenticated reads, blocked foreign navigation, no updater bridge, and no token in browser storage.
- Dependency audit reports zero known vulnerabilities across 648 dependencies at the time of review. This is a point-in-time result, not a guarantee of vulnerability-free code.
- Gitleaks scanning of the staged source and branch history passes with one exact-fingerprint exception for the inherited public analytics project key. The analytics code has been removed. No real private credential was confirmed during this review.
- Final original-workspace hash comparison: all 30 manifest entries match.

## Still required before publication or distribution

1. Sync the reviewed branch to the private repository and run its CI on the exact candidate commit, including Windows and relocated Linux packaging checks. Those platforms were not executed locally on this Mac.
2. Review and merge the intended branch into the default branch. Review other public-facing branches, historical documents/images, attachments, and any newly generated artifacts before changing visibility.
3. Establish a working private vulnerability-reporting contact and verify available GitHub branch rules, required checks, dependency security, and secret protection. These account settings have not been enabled by this source change.
4. Obtain owner approval for the actual visibility change and verify the resulting public repository.
5. Before distributing installers, verify macOS signing/notarization, Windows publisher signing, Linux package behavior, checksums, and installation on clean supported machines. Enable updates only after signed update verification and rollback are established.

The application remains experimental. This review and its regression tests do not constitute a full penetration test of every provider, external integration, or operating-system capability. Further decomposition of the large server router and broader route-schema coverage remain maintenance work; the authentication and approval boundaries addressed here are implemented now.

See [the release checklist](release-readiness.md) for the full gates and [SECURITY.md](../SECURITY.md) for the current security model.
