# Using Agent Harbor

This guide describes the September 7, 2026 local development app. For the exact
verification state, see the [handoff](plans/current-handoff.md).

## Talk with Jinx

Choose **Jinx** in the sidebar and send a message. This connects to her existing
system on the Mac Mini, with her identity and memory there. The Mini must be
awake and reachable through the configured SSH connection.

You can ask her to find a memory, recall earlier work, or coordinate a teammate.
Harbor and Discord have separate live conversations. Harbor exchanges are saved
and summarized through Jinx's staging process; a saved receipt confirms that
step, not that the summary has already been promoted into durable warm memory.
See [Jinx and memory](jinx-connection.md).

Jinx can see teammate descriptions and busy/idle status. She can ask an
available teammate a question and receive its reply, or delegate work to run
separately. She does not automatically see their complete chats or keep watch
in the background. A private local agent does not send its notes to cloud agents.

## Choose where information is processed

Use a local-model agent for work you want processed by your locally configured
model server. Use a cloud-backed agent when you want its model and connected
services. Each agent's model picker shows its selected connection.

Local-model agents can work with notes and attachments and use local schedules.
They do not receive Harbor cloud apps, commands or desktop control. Text-only
models can read document text and speech transcripts. Pictures, scanned pages
and video frames need a vision-capable model. Local vision currently depends on
explicit model capability information from the local server.

For private local work, use direct text conversations. The direct chat disables
cloud voice, but group calls lack that privacy guard. See [voice](voice-mode.md).

Changing a local agent to a cloud model can send the current task's history to
that provider when you continue. Start a new task when changing privacy modes.
See [local work](local-work.md) for the model-server setup and limits.

## Save notes in Obsidian

Open an agent's settings and choose **Local work and notes → Permitted folder**.
Use a vault or subfolder appropriate for that agent. Ask it to save a named
Markdown note and to read that note when needed later. There is no automatic
whole-vault memory feed.

A cloud agent receives the excerpts it reads. Keep private notes in a separate
folder used by local agents. Obsidian or folder sync settings still apply.

## Share files, audio and video

Use **Attach files**, drag files into the conversation, or paste a screenshot.
Wait for preparation to finish, then send your request. Files appear as
attachments in the message and can be downloaded again.

Examples of useful requests:

- “Summarize this document and tell me which sections support your answer.”
- “Compare the totals on these spreadsheet sheets; flag formulas with missing cached results.”
- “Read page 3 of this scanned PDF.”
- “Transcribe this recording, including the section after ten minutes.”
- “Describe the video frame at 30 seconds and summarize the speech.”

Harbor saves originals locally. Cloud agents receive extracted previews and
requested content after you send. Video support uses speech and sampled frames;
it does not watch every moment continuously. The [attachment guide](attachments.md)
lists supported formats and size limits. Attach a file again to share it in a
different task. Removing a draft attachment chip does not delete its saved copy.

## Emoji and profile pictures

Type or paste emoji normally. On Mac, **Control-Command-Space** opens the system
emoji picker. Jinx and other agents can include emoji in their replies. Hover a
message to add one of the available reactions: 👍 ❤️ 😂 🎉 👀. Agents do not
currently have a tool for adding reactions to existing messages.

Click an agent's name to open its profile settings, then choose **Choose picture**.
PNG, JPG, WebP and GIF images are accepted up to 20 MB. Harbor makes a square
profile image and saves it locally; GIFs become still pictures. **Use mascot**
restores the animated mascot. **Reset** also restores its default color and
expression.

## Approvals and stopping work

In direct API-model conversations, permitted-folder reads and reversible text
writes can run during attended work. Commands, connected-app actions and new
schedules show concrete approval cards unless the exact action is already
remembered. **Always allow** remembers the tool and exact arguments, including
for future unattended runs; it does not grant every action in a service.

**Allow desktop actions during attended tasks** gives the agent permission to
interact with the selected host computer, including actions that may submit a
form or change a site. It does not inspect every click for consequences. Keep
that setting appropriate to the work you intend to authorize. The experimental
Local VM uses a separate policy described in [OpenRouter](openrouter.md).

Use **Stop** to interrupt a running task. Local schedules need Harbor and the
chosen provider service running. Broader remote access over Tailscale and
Grokbot data migration remain future work.
