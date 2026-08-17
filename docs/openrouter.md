# OpenRouter

OpenRouter is an optional API-backed Agent Harbor engine. It lets each bot use a
text model available to your OpenRouter account without installing another CLI.

## Setup

1. Create a key in [OpenRouter API Keys](https://openrouter.ai/settings/keys).
2. Open Agent Harbor **Settings → Connections**.
3. Paste the key under **OpenRouter API key** and choose **Save**.
4. Open a bot's model picker, select **OpenRouter**, and choose a model.

The key is write-only. Agent Harbor stores it in macOS Keychain, or in the
private mode-`0600` credential fallback on Windows and Linux. The renderer sees
only whether the key is configured. It is not written to `config.json`, returned
by `/api/config`, included in native event logs, or sent to another provider.
`OPENROUTER_API_KEY` remains available as a server-side environment fallback.

## Model discovery and chat

Agent Harbor requests OpenRouter's account-filtered `/models/user` catalog and
shows text-capable results in the normal per-bot model picker. Conversations use
the OpenAI-compatible `/chat/completions` endpoint with SSE streaming. Active
turns can be interrupted, and reported prompt/completion token counts flow into
the normal Agent Harbor usage events.

This first API-native integration provides transcript-replay text chat. It does
not yet expose Agent Harbor's computer, connected-app, host-file, or peer-agent
MCP tools to OpenRouter models. Those capabilities require a provider-neutral
tool loop with the same approval controls as the CLI/ACP engines; the UI
therefore reports OpenRouter's computer capability as unavailable instead of
presenting controls that cannot work.

OpenRouter model availability, pricing, limits, and retention policies can
change. Agent Harbor discovers the live account catalog and leaves those mutable
details to [OpenRouter's documentation](https://openrouter.ai/docs/quickstart).
