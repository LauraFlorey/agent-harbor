# Testing the Agent Harbor beta

The first tester group uses Apple Silicon Macs and Windows x64 PCs. Signing enrollment is deferred. Start with a guided source setup; paid Apple Developer and Windows code-signing accounts are not required for this path. AI providers may charge separately.

## Source setup

1. Get repository access from the owner while it is private. Use the commit or tag supplied with the test invitation so bug reports identify the code tested.
2. Install Node.js 24 or later, pnpm 10.33.0, and Git if you plan to clone the repository. You can also download the source ZIP and extract it.
3. Open Terminal on Mac or a terminal on Windows in the extracted/cloned project folder.
4. Install the dependencies and start the app:

   ```sh
   pnpm install --frozen-lockfile
   pnpm dev:all
   ```

   If PowerShell blocks the `pnpm.ps1` launcher, use the installed `pnpm.cmd` commands instead of changing execution policy:

   ```powershell
   pnpm.cmd install --frozen-lockfile
   pnpm.cmd dev:all
   ```

5. Connect one provider you own. OpenRouter text chat uses an API key configured in App Settings and does not need a provider CLI. Claude and Codex require their own installed, authenticated CLIs. Account access, model availability, and usage charges depend on the provider.
6. Create a test bot. Leave computer access, host-folder access, and automatic approval off for the first session.

Keep the launcher terminal open while using the app. Press Control-C there to stop the development stack. Start it again with `pnpm dev:all` (or `pnpm.cmd dev:all`). Keep the app's server ports local; this beta is not a shared hosted service. Do not share session access codes or provider keys.

Record `git rev-parse HEAD` if you cloned the source, or record the supplied commit/tag if you downloaded a ZIP. Do not update a test checkout with uncommitted personal changes without reviewing them first. Source updates are manual; no automatic installer update is enabled.

## First test session

- Send a harmless text question and confirm a real reply.
- Rename the bot, create a fresh task, and return to the first task.
- Create a test room and send a message.
- Stop and restart the app; confirm the settings and conversations remain.
- Report the app commit/version, operating system, provider/model, reproduction steps, and expected versus actual behavior. Remove keys and private content from screenshots or logs. Use the private reporting path in [SECURITY.md](../SECURITY.md) for security problems.

Start with nonsensitive test material. Data is stored locally, but prompts and tool results are sent to the AI provider or connected service selected by the tester. The app does not include a free AI subscription. See [privacy and local data](../README.md#privacy-and-local-data).

## Optional features and platform differences

Bots, text chat, model switching, tasks, and rooms are the initial beta scope. Windows does not currently support microphone dictation or direct host-desktop control/preview. Those Mac capabilities require their own acceptance and, where applicable, explicit OS permissions.

Voice, Local VM actions, cloud computers, external integration actions, and unattended scheduling require additional setup and end-to-end testing. A successful source launch or package build does not verify them. Keep experimental permissions off until testing that specific feature deliberately.

## Can we test without running from source?

An owner-approved, clearly labeled unsigned package can be evaluated by a small test group after installation and launch have been checked on a separate machine. That is a possible later route, not a claim that the existing private checkpoints are ready for distribution.

- **Mac:** a development signature is not a Developer ID signature or Apple notarization. macOS may warn or block opening. Follow [Apple's guidance](https://support.apple.com/102445) only for the exact app and source you have chosen to trust; do not treat a damaged-app or malware warning as a routine approval prompt.
- **Windows:** the installer is unsigned. SmartScreen, Smart App Control, or an organization's device policy may warn or block it. Not every block offers a per-app override. See [Microsoft's overview](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview).

Do not disable system-wide security controls to install a beta. If device policy also blocks a source setup, use an appropriate test machine or wait for a supported release. A README disclaimer does not make a blocked application run.

Before sharing a package, record its version, exact source commit, SHA-256 checksum, signing status, and clean-machine test results. Keep personal data and credentials out of the package. Any public source release and any installer distribution are separate owner decisions. Signed installers and automatic updates can be added later.
