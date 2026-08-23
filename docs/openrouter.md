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

All account-available, text-capable OpenRouter models remain available for
ordinary chat. Local VM access is a separate, experimental capability; it does
not narrow the model picker or change ordinary text requests.

## Experimental Local VM access

OpenRouter Local VM access is off by default at both levels required to use it:

1. The owner enables **App Settings → Local VM → OpenRouter Local VM**.
2. The owner separately enables **OpenRouter Local VM** for one agent and
   selects **Local VM** as that agent's computer.

The initial verified-model manifest contains exactly
`openai/gpt-5.6-terra`. On every direct-agent turn, Agent Harbor also verifies
that the current account catalog contains that exact ID and currently reports
text and image input, text output, and tool support. Missing, stale, malformed,
or conflicting metadata disables tools while leaving text chat available.
Aliases, routers, wildcards, fallbacks, `openrouter/auto`, and every other exact
model ID are text-only. Multi-agent rooms also remain fully usable but do not
receive this new OpenRouter tool loop during the initial rollout.

The application, not the model or provider, owns the destination and approval
decision. Eligible turns can discover tools only from the validated isolated
Local VM. They receive no host Mac, cloud-computer, connected-app, file, dweb,
peer-agent, working-directory, credential, or environment access. The model
cannot start Docker or the Local VM; when it is unavailable, prepare it in
**App Settings → Local VM**.

Every proposed tool call is shown sequentially with the requesting agent,
model, exact discovered tool, Local VM destination, safe bounded details, and
one-attempt 30-second expiry. The available decisions are **Allow once**,
**Deny**, and **Cancel turn**. Auto mode, remembered permissions, and Always
allow never approve this path. Denial permits at most one final tool-free reply
explaining what did not happen.

Each turn keeps one exclusive Local VM lease and the original limits for time,
approvals, calls, arguments, results, requests, repetitions, and telemetry.
Interruption, provider or MCP failure, renderer loss, timeout, or disabling the
global switch cancels the provider request, closes the turn-scoped MCP process,
resolves pending approval state, and releases the lease. Disabling the global
switch is the one-step rollback; saved per-agent preferences remain inert and
ordinary OpenRouter text chat continues.

For controlled testing, use a harmless test page and verify screenshot, click,
scroll, typing, approval-before-action, interruption, cleanup, and Computer Off
before using a real site. If a site requires a password, MFA, or CAPTCHA, Laura
completes that step directly in the visible Local VM. Credentials and protected
values must never be pasted into chat or entered by the model.

OpenRouter model availability, pricing, limits, and retention policies can
change. Agent Harbor discovers the live account catalog and leaves those mutable
details to [OpenRouter's documentation](https://openrouter.ai/docs/quickstart).
