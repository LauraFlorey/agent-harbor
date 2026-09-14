# Private installation, packaging, and recovery guide

Updated September 7, 2026. Recent changes are in a modified source development
checkout; no new personal installer has been accepted.

Agent Harbor is a private personal application for Laura. There is no current
plan for a public or open-source Agent Harbor release. Source builds, private
branches, optional local packages, installed personal checkpoints, backups,
and recovery tests remain separate states.

## State definitions

Use these terms consistently in handoffs and personal checkpoint notes:

| State | Meaning |
|---|---|
| Implemented | The change exists in a local worktree. |
| Verified | The required tests or manual checks passed for the named commit and platform. |
| Committed | Git contains the change locally. |
| Pushed | The exact commit exists on the private origin. |
| Merged | The exact commit is reachable from `origin/main`. |
| Packaged | A platform artifact was built from the exact commit. |
| Installed/active | The selected personal build was installed or started and its core behavior was checked on Laura's target device. |
| Recoverable | The prior known-good build, configuration, and required private data can be restored through a tested procedure. |

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
Docker. Jinx is a separate application on the Mini. Its explicitly installed
bridge has its own [deployment procedure](jinx-connection.md); an ordinary Harbor
restart or cleanup must not restart or modify Jinx.

## Optional services and recent dependencies

Configure a usable provider separately: a logged-in CLI, cloud API connection,
local inference server, or the Jinx Mini bridge. Harbor startup alone does not
start the local model service or make the Mini reachable. For host desktop work,
the development app can start an installed CuaDriver; macOS permissions are still
required. A Local VM must be prepared explicitly.

Attachment parsing now depends on Mammoth, SheetJS, PDF.js, Sharp and native
canvas/image dependencies declared in `package.json` and the lockfile. Speech and
video processing require `ffmpeg`, `ffprobe`, `whisper-cli`, and the local model
file `~/.openmausbot/media-models/ggml-base.bin`. They are configured on Laura's
current Mac, not automatically guaranteed on another machine. Legacy DOC/RTF
extraction uses macOS `textutil`; other platforms should use DOCX.

Before promoting an installer, verify its actual runtime dependency closure,
including parser workers, native modules and external media tools/model files.
Existing packaging scripts and a successful source build do not establish that
the new attachment functionality is self-contained in the app. See
[attachments](attachments.md) for the format and provider acceptance limits.

## Backup scope

There is no completed one-click backup/restore feature or accepted restoration
procedure yet. A personal backup plan must cover:

- `~/.openmausbot/`, including configuration, agent records, conversations,
  events, schedules, attachment originals and prepared content;
- permitted folders and Obsidian vaults outside that directory, including any
  `.harbor-attachments/` working copies;
- Harbor credentials in Keychain or the platform fallback, and separately
  managed CLI logins, using their appropriate secure recovery procedures;
- Jinx configuration, identity and memory on the Mini, plus any existing remote
  archives under their own backup procedures; and
- the exact source checkpoint or prior app artifact and its runtime dependencies.

Keep these backups private and outside the repository. Confirm restoration on a
separate copy before describing a checkpoint as recoverable. The Jinx bridge
installer's code backup does not substitute for a memory backup.

## Remote access and migration

The app API is loopback-only and has no user authentication. Hosting Harbor on a
local machine and connecting through Tailscale remains future work; do not make
the existing app port remotely reachable as a shortcut.

Webhook ingress is separate: its default port is 8800 (or one above `OMB_PORT`),
overridable with `OMB_WEBHOOK_PORT`. It exposes `/health` and secret `/hooks/...`
endpoints. Bearer authentication avoids putting the trigger secret in a URL;
capability URLs remain available for senders without header support. If remote
webhook delivery is configured, proxy only that receiver. Harbor must be running.

Grokbot migration is deferred until Laura has tried Harbor and chooses the data
to import. No Grokbot records were copied or deleted. Inspect formats and preserve
originals before an import; do not assume connector logins or Jinx memory belong
in Harbor's chat store.

## Required verification before personal packaging

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
provider, Local VM, installer, update, backup, or recovery test.

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

### macOS personal target

`pnpm package:mac` builds the UI, server, updater bundle, speech helper, and
bundled CUA resources. The current builder configuration has notarization
disabled. Signing and notarization are not current public-release goals, but a
personal package still needs installation, macOS permission, startup, update,
and rollback evidence before it replaces Laura's known-good build.

### Windows

Run the manual **Package Windows** workflow from the exact candidate commit.
It builds on a real Windows runner, verifies the packaged server, UI, and
updater metadata, and retains an artifact for 14 days. The workflow is
artifact-only and has no publishing credentials. The current Windows installer
is unsigned. Windows packaging is not a current product priority unless Laura
chooses a Windows device as a personal target.

### Ubuntu

The normal CI job builds and smoke-tests Ubuntu 24.04 x64 packages. Installer
artifacts are uploaded only when CI is started manually, and those artifacts
are retained for one day. See [Ubuntu Desktop](linux-desktop.md) for the exact
package verifier, smoke test, capabilities, and platform limits. Ubuntu is not
a current personal target unless Laura explicitly adds one.

## Continuous integration

The following describes configured workflows, not fresh remote CI results for
the current uncommitted worktree.

CI runs type checking, the full test suite, and Electron syntax checks on
macOS, Ubuntu, and Windows. Ubuntu additionally receives a production UI build,
package verification, and a packaged-app lifecycle smoke test. CI has
read-only repository permissions and does not deploy or publish a release.

The Windows packaging workflow is also manual and artifact-only. A green
workflow therefore means the named commit built successfully; it does not mean
that a personal build was installed, accepted, or recoverable.

## Personal installation and promotion gate

Do not publish or distribute Agent Harbor externally. Before replacing Laura's
working installation or promoting a new private checkpoint:

1. Confirm the candidate commit, branch, clean worktree, origin synchronization,
   version, and intended file list.
2. Confirm required automated checks on the exact commit.
3. Complete the checks for Laura's actual target device and record all other
   platforms as unverified and out of current scope.
4. For OpenRouter Local VM changes, complete the controlled acceptance plan in
   [the Local VM sprint document](plans/openrouter-local-vm-tool-loop.md). Do
   not substitute a credentialed production site for the controlled fixture.
5. Inspect artifacts for secrets, credentials, local paths, generated logs, and
   unrelated files.
6. Preserve the prior known-good build, settings backup, and rollback path
   before installing the candidate.
7. Install or start the exact candidate on Laura's target device and verify
   startup, core workflows, permissions, updater behavior if used, and rollback.

If any gate fails, leave the existing installed version in place, keep the
feature's global switch off where applicable, preserve logs, and return to a
new reviewed commit. Do not overwrite a known checkpoint or silently replace
artifacts under the same version.

## Current project status

The canonical current implementation, runtime, remote, and acceptance state is
kept in [Current handoff](plans/current-handoff.md). Update that handoff whenever
a checkpoint is committed, pushed, merged, packaged, installed, recovered, or
materially retested.
