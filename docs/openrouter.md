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

OpenRouter turns also receive the provider-hosted `openrouter:web_search`
server tool for current public-web research. It is independent of computer
access: OpenRouter executes the search, and Agent Harbor does not acquire a
Local VM lease or expose host/cloud computer tools for it. Agent Harbor caps a
request at 4 searches, 5 results per search, 12 results total, and low search
context. OpenRouter may use native provider search or its documented fallback,
and search charges are additional to model token charges.

Each agent can have owner-authored system instructions under **Agent Settings
→ Profile → System instructions**. They apply to that agent in both direct
conversations and rooms and do not change its provider, model, connected apps,
computer destination, or permissions. Do not put credentials in this field.

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

The first routine tool request in an attended task is shown with the requesting
agent, model, exact discovered tool, Local VM destination, and safe bounded
details. **Allow** grants routine Local VM actions only for that task. **Deny**
executes nothing and permits at most one final tool-free explanation. A fresh
task starts with no grant. Calls classified as consequential — including
credential entry, purchases, publishing, deletion, account changes, and
externally visible messages — always require a separate one-attempt decision.
Unknown tools, changed arguments, replayed decisions, invalid schemas, and
cross-turn reuse remain denied.

Auto mode is an explicit owner setting for attended personal use. It
pre-authorizes routine Local VM actions for the current task but never
consequential actions and never unattended/webhook work. Remembered tool grants
do not widen this Local VM policy.

Each turn keeps one exclusive Local VM lease and fixed monotonic limits for
time, approvals, calls, arguments, results, requests, repetitions, and
telemetry. The defaults are a 20-minute turn, 10-minute approval wait,
90-second per-call allowance beginning after approval, 20-second MCP request,
and 30-second tool execution. Approvals and retries never extend the original
20-minute turn deadline.
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
