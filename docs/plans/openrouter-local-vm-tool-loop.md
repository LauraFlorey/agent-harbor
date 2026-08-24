# Sprint: OpenRouter Local VM tool loop

## Outcome

An Agent Harbor bot using an OpenRouter model can operate the isolated Local
VM through Cua Driver while preserving the same destination boundaries,
approval cards, interruption behavior, and audit trail used by the CLI and ACP
engines.

This sprint is complete only when the model can inspect and operate a browser
inside the Local VM. Text chat alone, a mocked tool response, or a model that
can merely describe intended clicks does not meet the outcome.

## Scope

### In scope

- A provider-neutral, server-owned tool loop for API-backed model engines.
- OpenRouter Chat Completions tool declarations and streamed tool calls.
- Cua Driver tools from the explicitly selected Local VM.
- Existing Agent Harbor approval-card surface with a fresh application-owned
  Allow once decision for every OpenRouter Local VM call. Remembered approvals
  and Auto mode do not apply to this path.
- Strict Local VM lease, cancellation, timeout, and turn limits.
- Activity chips, screen refreshes, native-event redaction, tests, and setup
  documentation.

### Not in scope

- Jinx integration or changes of any kind.
- Silent access to this Mac, a cloud computer, connected apps, files, or peer
  agents.
- Automatic Facebook sign-in, credential entry, CAPTCHA handling, or attempts
  to evade a website's automation controls.
- Giving every OpenRouter model computer capability. The model catalog must
  distinguish models that reliably support tool calls.

Cloud and host-computer destinations can reuse the provider-neutral loop in a
later sprint after the Local VM boundary is proven.

## User story

> I can choose an OpenRouter model and the Local VM, ask the bot to inspect a
> webpage, watch its actions, approve consequential steps, interrupt it, and
> know it cannot silently fall through to my Mac or another computer.

## Architecture boundary

The harness remains the authority for destination selection and Local VM
leasing. The OpenRouter driver must never launch or select a computer itself.
`server/index.ts` validates the exact feature, agent, model, metadata,
conversation, and destination gates and passes an application-owned turn
bridge. The Story 5 coordinator then acquires the one authoritative shared
Local VM lease before resolving the endpoint or spawning the turn-scoped MCP
child. There is no separate legacy lease on this path.

The provider-neutral loop owns:

1. MCP initialization and tool discovery for the turn-scoped Cua endpoint.
2. Conversion from MCP tool schemas to OpenAI-compatible tool definitions.
3. Model response parsing, including streamed tool-call arguments.
4. Approval classification and the existing `request.opened` /
   `request.resolved` event contract.
5. Tool execution, result normalization, and continuation messages.
6. Cancellation, deadlines, call ceilings, cleanup, and redacted logging.

The OpenRouter driver owns only provider transport: requests, SSE parsing,
model selection, usage reporting, and provider-safe errors.

## Work plan

### Story 1 — Provider-neutral tool contract

- Extend provider capabilities so API-backed engines can declare a
  server-driven tool loop without pretending to mount MCP themselves.
- Add typed tool-call and tool-result structures to the harness contract.
- Keep existing Claude and ACP behavior unchanged.

**Checkpoint:** capability routing tests prove OpenRouter can be eligible for
the Local VM without changing Codex, Grok API, or other text-only engines.

### Story 2 — Turn-scoped MCP client

- Connect to the existing `integrations.localComputer` stdio descriptor.
- Initialize MCP, list tools, validate JSON schemas, and close the process on
  completion, interruption, timeout, or provider failure.
- Reject symlinked/untrusted executables and inherit only the allowlisted
  environment already produced by the Local VM connection builder.

**Checkpoint:** an integration test discovers Cua-style tools from a fake MCP
server and leaves no child process after every exit path.

### Story 3 — OpenRouter tool-call transport

- Send normalized tool definitions through `/chat/completions`.
- Accumulate streamed tool-call names, IDs, and argument fragments.
- Validate arguments before execution and return structured errors to the
  model rather than crashing the turn.
- Continue the conversation with assistant tool calls and tool-result
  messages until the model produces a final answer.

**Checkpoint:** recorded SSE fixtures cover one call, sequential calls,
malformed JSON, provider errors, cancellation, and a final text response.

### Story 4 — Approval and safety gate

- Route tool requests through Agent Harbor's canonical approval events.
- Default to denial when the approval channel is unavailable or times out.
- Preserve destructive-action detection and remembered approval keys.
- Require a fresh human decision for credential entry, purchases, publishing,
  deletion, account changes, and externally visible messages.
- Never send secrets or raw credential fields to OpenRouter logs.

**Checkpoint:** no mutating tool reaches the MCP server before an allow
decision; denial, timeout, and interruption all prevent execution.

### Story 5 — Limits, lease, and observability

- Retain the current single-owner Local VM lease for the entire tool loop.
- Add per-turn ceilings for tool calls, repeated identical calls, elapsed
  time, and tool-result size.
- Emit the existing activity chips and refresh the computer preview after
  relevant actions.
- Release the lease and terminate every child on success, error, cancellation,
  renderer loss, and server shutdown.

**Checkpoint:** stubborn-child and concurrent-bot tests prove that cleanup and
the one-bot-at-a-time fence hold.

### Story 6 — Product integration and documentation

- Keep the feature globally off and independently off for every agent until
  the owner explicitly enables both controls.
- Authorize only the exact source-controlled `openai/gpt-5.6-terra` ID, and
  require the current account catalog to confirm text/image input, text output,
  and tool support on every direct-agent turn. Catalog metadata can revoke
  eligibility but cannot add models.
- Keep every other account-available OpenRouter model usable for ordinary text
  chat, and preserve rooms, per-agent provider/model choices, existing tools,
  settings, permissions, and destinations.
- Restrict the new loop to direct conversations and the isolated Local VM;
  expose no host, cloud, apps, files, dweb, peer agents, or host environment.
- Connect application-owned Allow once/Deny/Cancel approval, bounded product
  states, immediate preview refresh with polling fallback, one-lease lifecycle,
  provider-neutral continuation, and a global-switch rollback.
- Document that passwords, MFA, CAPTCHAs, and other protected input are
  completed manually in the visible Local VM and remain outside prompts.

**Checkpoint:** an explicitly enabled direct Terra agent can use the ready
Local VM only after current metadata verification and per-call Allow once
decisions. Ineligible models remain text-capable, and disabling the global
switch cancels and drains active OpenRouter Local VM turns without changing
stored settings.

## Acceptance test

Use a controlled test webpage rather than a live social account for automated
CI and release verification.

1. Enable the global experimental switch and one test agent, select the exact
   `openai/gpt-5.6-terra` model and Local VM, and confirm the current catalog
   metadata is verified.
2. Ask the bot to open the controlled page and summarize visible content.
3. Watch it take screenshots, click, scroll, and type into a harmless form.
4. Confirm a consequential mock action produces an approval card and does not
   execute before approval.
5. Interrupt a second run mid-action and verify the OpenRouter request, MCP
   client, and Local VM lease all stop.
6. Restart Agent Harbor and verify there are no orphaned model or MCP
   processes.
7. Confirm selecting Computer Off gives the model no computer tools.

8. Disable the global switch during a test turn and verify clean cancellation,
   lease release, retained per-agent settings, and continued OpenRouter text
   chat.

After those checks pass, a person may perform a separate manual site smoke test
using an account they are authorized to access. The person signs in directly
inside the Local VM; credentials are never pasted into chat. Automated and
release tests use a controlled page rather than a live social account.

## Definition of done

- All six story checkpoints pass.
- Existing engine behavior and approval tests remain green on macOS, Windows,
  and Linux.
- The package smoke job passes.
- No credentials, tool arguments containing secrets, or raw screenshots enter
  native provider logs.
- Documentation states the supported destinations and model limitations.
- The feature remains behind capability checks until the complete acceptance
  test passes; no partial implementation advertises computer support.

## Roadmap after Story 6

### Paused — controlled acceptance

The first live approval-gated inspection passed on August 24, 2026: the Terra
test agent requested `get_accessibility_tree`, the owner chose Allow once, the
tool ran inside the isolated Local VM, and the agent returned a description of
the visible desktop. Automated tests, type checking, cleanup verification, and
the final security review also passed at checkpoint `cf11c7c`.

The second live test also reached the loopback-only fixture through Docker
Desktop's private host bridge. After separate Allow once decisions, Terra
reported the correct page title, main heading, and `Status: ready`. This proves
the provider, approval, MCP, read-only browser inspection, and final-response
path.

Controlled acceptance is paused at browser interaction. An approved visual
click missed the fixture button and returned a tool failure. A separate focused
retry used Cua's declared `page` / `click_element` action with the exact
`#harmless-button` selector; it was also approved and failed. The fixture
remained at `Status: ready`, the Local VM stayed healthy, the turn released its
lease, and no MCP guardian process remained.

Do not proceed to scroll, typing, interruption, rollback, package smoke, or
release claims on this path. Do not add another compatibility repair or broad
retry until the execution approach is re-evaluated.

### Next — evaluate OpenRouter Spawn

Run a time-boxed proof of concept on a separate branch or disposable workspace;
do not replace or modify the current checkpoint in place. Evaluate Spawn as a
possible execution backend for provisioning, agent installation, credential
injection, headless operation, status, and cleanup while Agent Harbor retains
its own UI, approval gate, audit trail, bot settings, and safety policy.

The proof of concept should compare:

- local sandbox and one cloud environment;
- structured headless output and lifecycle/error reporting;
- cancellation, cleanup, credential boundaries, and cost visibility;
- whether Agent Harbor can wrap Spawn behind a replaceable adapter without
  weakening Allow once or exposing the host Mac;
- the operational risk of depending on software that OpenRouter currently
  labels alpha.

The proof must begin with a local sandbox and dry-run or headless lifecycle
checks. Provision no paid cloud resource until cost, credentials, teardown, and
the exact test target are reviewed and explicitly approved.

### After the evaluation — choose one path

- If Spawn is simpler and at least as safe, design it behind a replaceable
  Agent Harbor adapter before changing product behavior.
- If Spawn cannot preserve the approval and audit boundary, keep the current
  checkpoint and investigate Cua browser action delivery as a separate,
  explicitly scoped story before resuming acceptance.
- Keep the diagnostic checkpoint separate from the Story 6 baseline until the
  complete acceptance record and chosen execution path are reviewed.
- Update public-facing status only after every required acceptance item is
  observed, not merely configured or tested with fixtures.
- Merge and push only after an explicit final review of acceptance evidence,
  branch scope, rollback behavior, and the chosen execution approach.

See the [OpenRouter Spawn repository](https://github.com/OpenRouterLabs/spawn)
for its current supported matrix and alpha status.
