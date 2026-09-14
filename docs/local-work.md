# Local work and model connections

Current behavior, September 7, 2026. The action tools below describe direct
conversations; API-model rooms currently receive attachment tools only.

Agent Harbor stores its agents, transcripts, tasks, schedules and configuration on
this computer. Cloud models still receive the messages and tool results needed
for their tasks. A cloud API is not local inference.

## Local model

Start an OpenAI-compatible server in LM Studio (normally
`http://127.0.0.1:1234/v1`) or Ollama (`http://127.0.0.1:11434/v1`). Load a chat
model, then use App Settings → General → Local model. Only literal loopback HTTP
addresses are accepted, and redirects are rejected. No API key is needed for
this connection. Select **Local model** in the agent's model picker.

Local-model turns have file, schedule and attachment tools. They receive no provider-hosted
web search, connected cloud apps, shell commands or computer tools. They do not
fall back to a cloud model. Direct local chat disables cloud speech controls.
Group calls and the generic speech endpoint do not enforce the same per-agent
privacy boundary; use direct text conversations for private local work. See
[voice limitations](voice-mode.md). Private local
agents reject incoming delegation from cloud agents and cannot participate in
mixed local/cloud rooms. Switching a local agent to a cloud model displays a
notice that continuing the current task will send its history to that provider.
Use a new task and an appropriate folder when switching privacy modes.

For attachments, local speech transcription and document extraction remain
available to text-only models. Images, scanned PDF pages and video frames require
vision. Harbor currently checks `/api/v1/models` for an explicit `vision: true`
capability matching the selected model's key or loaded instance ID. This is
verified with LM Studio; an otherwise compatible server without that capability
response remains text-only in Harbor. Installed models alone do not enable vision.
See [attachments](attachments.md).

The local server itself must be configured to run a model on this computer.
Agent Harbor cannot establish where a separately configured inference server
ultimately performs its computation.

## Files and Obsidian

Each agent has a private workspace. In its settings, **Local work and notes →
Permitted folder** can instead select an existing local folder, Obsidian vault,
or vault subfolder. Choosing a folder does not upload its contents. File reads
and search excerpts become context for the selected model. Keep private local
notes separate from folders given to cloud agents.

Available tools list files, read text, search Markdown/text notes and write text.
Writes require an existing parent folder, exclude symlinks, and keep a recovery
copy when explicitly overwriting. File limits keep individual reads below 256 KB.
Search is bounded to 1,500 files, 16 MB and 30 matches. There is no automatic
whole-vault indexing or cross-agent memory feed. Ask an agent to save important
facts in a named Markdown note, and to retrieve relevant notes on later tasks.

Obsidian vaults under iCloud or another sync service may leave the Mac through
that service. Agent Harbor does not change an existing vault's sync settings.

## Cloud models and actions

OpenRouter now uses the application-owned tool loop for local files, approved
commands, supported connected-app tools, scheduling, and peer coordination.
**This computer** uses the installed CuaDriver connection. It must be running
and have the required macOS permissions. The development desktop starts the
installed CuaDriver app if needed; packaged embedding retains its existing path.
Only desktop interaction tools are exposed, not driver configuration, recording
or update tools. One API-model turn can own the host desktop at a time.

App connection failures leave local tools available and expose a status tool
that explains the missing connection. Credentials remain in the harness.
The existing Terra Local VM route and its separate controls are preserved.
Cloud-box operation still requires a configured cloud provider and a supported
engine. Native Codex can now initiate peer coordination.

## Standing permissions

- Reads and reversible file writes inside the permitted folder run directly.
- **Allow scheduled tasks to read and save notes** authorizes those actions on
  unattended runs. It grants no shell, connected-app or desktop authority.
- **Allow desktop actions during attended tasks** permits clicks, typing and
  other desktop interactions on the explicitly selected computer. Such actions
  can submit forms or change sites. This is owner authorization, not an AI
  action reviewer. That setting alone does not authorize unattended desktop work.
- Commands, connected-app execution and schedule creation ask for the concrete
  action. **Always allow** remembers the exact tool and serialized arguments.
  Matching remembered grants are also honored on unattended runs. They do not
  grant a whole service or arbitrary shell commands.
- A denied action ends further tool execution in that model turn. Stop aborts
  pending approvals and closes owned MCP sessions. Generic action turns have an
  80-call ceiling and a 20-minute limit.

A command's working folder is not a sandbox. Approved commands execute with the
local user's OS permissions. This distinction is shown on command approvals.

Local schedules require Agent Harbor and the selected local model service to be
running. No always-on cloud scheduler or migration from another product is implied.
