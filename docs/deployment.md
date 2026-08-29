# Deployment and release guide

Agent Harbor is currently distributed as a source-built desktop application.
There is no automated production deployment and no published signed release.
Building a package, uploading a workflow artifact, publishing a GitHub release,
and confirming that an installed update works are separate checkpoints.

## State definitions

Use these terms consistently in handoffs and release notes:

| State | Meaning |
|---|---|
| Implemented | The change exists in a local worktree. |
| Verified | The required tests or manual checks passed for the named commit and platform. |
| Committed | Git contains the change locally. |
| Pushed | The exact commit exists on the private origin. |
| Merged | The exact commit is reachable from `origin/main`. |
| Packaged | A platform artifact was built from the exact commit. |
| Released | The intended artifacts and update metadata were published together in a GitHub release. |
| Installed/live | The released artifact was installed and its startup, update, and core behavior were checked on the target platform. |

None of these states implies the next one.

## Development runtime

Requirements are Node 24 or newer and pnpm 10.33.0, as declared in
`package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev:all
```

The unified launcher owns the harness, interface, and Electron development
processes. The default local endpoints are:

- harness API: `http://127.0.0.1:8799/api/health`
- webhook receiver: `http://127.0.0.1:8800/health`
- interface: `http://127.0.0.1:5199/`

Closing the Agent Harbor window or pressing Control-C in the launcher terminal
is the documented shutdown path. Do not use broad name-based process cleanup.
If a launcher child exits unexpectedly, preserve the launcher log and inspect
the exact owned process tree before restarting anything.

The Local VM is a separate, explicitly prepared Docker-backed destination.
Starting the development runtime must not start, stop, recreate, or repair
Docker. Jinx is a separate application and is never part of an Agent Harbor
deployment or cleanup operation.

## Required verification before packaging

Run the repository checks from a clean checkout of the exact candidate commit:

```sh
pnpm typecheck
pnpm test
pnpm check:electron
pnpm build
git diff --check
```

For a behavior change, also run its focused tests and record any controlled
manual acceptance that is still outstanding. A successful build is not a live
provider, Local VM, signing, installer, or update test.

## Package commands

All package scripts use `electron-builder --publish never`; they write local
artifacts under `release/` but do not publish them.

```sh
pnpm package:mac      # macOS arm64 DMG + ZIP
pnpm package:win      # Windows x64 NSIS installer + ZIP
pnpm package:linux    # Ubuntu x64 .deb + AppImage
```

Generated `dist/`, `dist-server/`, `dist-native/`, and `release/` output must
not be committed. Package from a clean checkout so stale output cannot enter an
installer.

### macOS

`pnpm package:mac` builds the UI, server, updater bundle, speech helper, and
bundled CUA resources. The current builder configuration has notarization
disabled, so a local DMG or ZIP is not proof of a signed and notarized public
release. Signing, notarization, stapling, installation on a clean Mac, macOS
permission prompts, and update behavior require separate evidence.

### Windows

Run the manual **Package Windows** workflow from the exact candidate commit.
It builds on a real Windows runner, verifies the packaged server, UI, and
updater metadata, and retains an artifact for 14 days. The workflow is
artifact-only and has no publishing credentials. The current Windows installer
is unsigned, so signing and SmartScreen behavior remain release decisions.

### Ubuntu

The normal CI job builds and smoke-tests Ubuntu 24.04 x64 packages. Installer
artifacts are uploaded only when CI is started manually, and those artifacts
are retained for one day. See [Ubuntu Desktop](linux-desktop.md) for the exact
package verifier, smoke test, supported capabilities, and platform limits.

## Continuous integration

CI runs type checking, the full test suite, and Electron syntax checks on
macOS, Ubuntu, and Windows. Ubuntu additionally receives a production UI build,
package verification, and a packaged-app lifecycle smoke test. CI has
read-only repository permissions and does not deploy or publish a release.

The Windows packaging workflow is also manual and artifact-only. A green
workflow therefore means the named commit built successfully; it does not mean
that a release was created or installed.

## Manual release gate

Do not publish without explicit owner approval. Before creating a release:

1. Confirm the candidate commit, branch, clean worktree, origin synchronization,
   version, and intended file list.
2. Confirm required automated checks on the exact commit.
3. Complete the platform-specific package and installation checks and record
   any unverified platform honestly.
4. For OpenRouter Local VM changes, complete the controlled acceptance plan in
   [the Local VM sprint document](plans/openrouter-local-vm-tool-loop.md). Do
   not substitute a credentialed production site for the controlled fixture.
5. Inspect artifacts for secrets, credentials, local paths, generated logs, and
   unrelated files.
6. Publish the platform artifacts and their matching updater metadata from the
   same commit. In particular, macOS needs its ZIP plus `latest-mac.yml`, and
   Windows needs its NSIS installer plus `latest.yml`.
7. Verify the public release contents, a clean install, app startup, and the
   updater path before describing the release as live.

If any gate fails, leave the existing installed version in place, keep the
feature's global switch off where applicable, preserve logs, and return to a
new reviewed commit. Do not overwrite a known checkpoint or silently replace
artifacts under the same version.

## Current project status

The canonical current implementation, runtime, remote, and acceptance state is
kept in [Current handoff](plans/current-handoff.md). Update that handoff whenever
a checkpoint is committed, pushed, merged, packaged, released, or materially
retested.
