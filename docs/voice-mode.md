# Voice in Agent Harbor

Current behavior, September 7, 2026. Spoken replies, microphone dictation and
transcribing an uploaded recording are separate features.

## Spoken replies and calls

Harbor uses **ElevenLabs** for spoken replies. Configure its key in App Settings
and select a voice, optionally per agent. Both the key and a voice are required.
The harness makes synthesis requests; the UI sees configuration status and audio,
not the stored key. Text sent for speech is processed by ElevenLabs.

The speaker button reads a reply. Auto-speak reads replies as they arrive.
Direct calls and group-call UI exist on macOS, using native dictation and the
configured voices. Jinx can use Harbor's voice interface through her existing
provider connection. This documentation refresh did not perform a new live
ElevenLabs call or group-call acceptance test.

Direct local-model chats disable the call button, per-message speech and
auto-speak in the UI. There is no local TTS fallback currently implemented.
A working local speech-to-text attachment reader does not enable spoken replies.

**Known privacy gap:** group-call code does not apply the same local-model guard,
and the generic speech endpoint does not bind a request to a bot's privacy mode.
With ElevenLabs configured, those paths can send supplied text to cloud speech.
Use direct text conversations for private local work until group voice and
server-side speech authorization are covered. This gap was identified by source
inspection during the documentation refresh; no private content was sent to test it.

## Microphone dictation

The desktop macOS helper uses Apple's `SFSpeechRecognizer` with on-device
recognition required. Composer dictation is press-to-stop. Call mode adds a
silence timeout to complete a spoken turn. The microphone must have the required
macOS permissions; this native feature is unavailable in the browser-only UI
and on the other desktop platforms.

Calls are half-duplex: capture pauses during playback so the agent does not hear
its own voice. Interrupt with the available call controls, Space or Escape.
Full-duplex voice barge-in is not implemented. Approvals and questions are
presented through the call flow; unclear approval answers are not treated as
consent. Leaving a call ends its microphone session.

## Uploaded recordings

Attached audio/video uses local FFmpeg and whisper.cpp, independently of
ElevenLabs and microphone dictation. The first ten minutes of speech are
prepared automatically and later segments can be requested. Video also permits
selected timestamped frames. This is not general sound analysis, speaker
identification or continuous video understanding.

This path is available to local-model agents for transcripts; a vision-capable
model is required for frames. See [attachments](attachments.md) for formats,
dependencies, privacy and limits.

## Implementation and remaining work

Speech components live in `src/lib/tts/`, `src/components/CallView.tsx`,
`src/components/GroupCallView.tsx`, `server/tts/`, and `electron/speech.mjs`.
The harness prepares Markdown as speakable text and bounds utterances. Synthesis
requests are cancellable. Direct local-model speech restrictions are currently UI checks, not a
complete server-side privacy boundary.

Known limits include cloud TTS dependency, no integrated ElevenLabs spend meter,
macOS-only native dictation/calls, and no full-duplex echo cancellation. Earlier
voice design tradeoffs do not imply that every agent is a local Claude CLI or
that rooms lack voice UI.
