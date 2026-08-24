# Sprint: OpenRouter Local VM tool loop

Current status and branch handoff: [Agent Harbor current handoff](current-handoff.md).

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

### Deferred — OpenRouter Spawn evaluation

A time-boxed local proof of concept ran on August 24, 2026, in a disposable
workspace outside Agent Harbor. It used Spawn `v1.1.1`, Bun `1.4.0`, Docker
Desktop, and a one-day OpenRouter test key capped at `$1`. No cloud provider was
configured or launched.

The proof established that:

- the plain Codex / Local Sandbox dry run completed with exit code `0` and
  provisioned nothing;
- the sandbox image starts without a host bind mount, so it did not expose the
  Agent Harbor repository, Jinx, the host shell, or host SSH keys;
- failed runs removed their containers and left no Spawn process behind;
- the test key recorded `$0.000` usage because no model prompt completed; and
- Agent Harbor and Jinx remained unchanged.

The proof also found blocking alpha-compatibility and lifecycle-reporting
problems:

- combining `--dry-run` with headless execution bypassed the dry-run branch and
  entered authentication and provisioning instead;
- non-headless prompt execution forced `docker exec -it` and failed when no TTY
  was attached;
- headless prompt execution called `codex --full-auto`, but the Spawn image's
  Codex CLI `0.132.0` rejects that obsolete argument and requires the newer
  non-interactive `codex exec` path; and
- Spawn returned process exit code `0` after reporting that prompt execution
  failed, so its success status cannot currently be trusted for automation.

The Spawn evaluation is therefore deferred. Do not patch the vendor image,
switch to another agent merely to bypass the Codex incompatibility, provision a
cloud environment, or design an Agent Harbor adapter from this checkpoint.
Re-evaluate only after a newer Spawn release fixes Codex prompt execution,
honors dry-run before headless dispatch, and returns a failing status when the
agent prompt fails.

### Next — return to controlled Agent Harbor work

- Treat Spawn as unavailable for the current Issue #11 acceptance path.
- Use [Issue #16](https://github.com/LauraFlorey/agent-harbor/issues/16) for the
  diagnosis-only Cua browser-action story. Reproduce one harmless click, locate
  the lowest failing boundary, and add a deterministic failing regression test
  before proposing or implementing a repair.
- Keep the diagnostic checkpoint separate from the Story 6 baseline until the
  complete acceptance record and chosen execution path are reviewed.
- Update public-facing status only after every required acceptance item is
  observed, not merely configured or tested with fixtures.
- Do not broaden Issue #16 into scrolling, typing, live-account activity,
  credential handling, Spawn, Jinx, cloud resources, or host-computer access.
- The diagnostic and model-picker branches are pushed to the private remote but
  remain unmerged. Merge only after an explicit final review of acceptance
  evidence, branch scope, rollback behavior, and the chosen execution approach.

See the [OpenRouter Spawn repository](https://github.com/OpenRouterLabs/spawn)
for its current supported matrix and alpha status.

### Separate experiment — Barehands Thursday demo

[Barehands](https://github.com/jaredrhod/barehands) is being rehearsed as a
standalone, local, user-controlled visual demo. It is not an Agent Harbor
agent, computer-use provider, Issue #11 dependency, or accepted product
integration.

The demo uses an unmodified sibling checkout pinned to upstream commit
`bdd8df505b290287dc5483844eb43d61fa1b74af`, included sample notes and media,
Chrome camera permission, and a local server bound to `127.0.0.1:8794`. A
separate user-triggered helper can place one harmless explanatory card on the
board. No personal notes, credentials, Agent Harbor data, Cua path, model call,
or agent connection is configured.

The current hand tracking is visibly experimental. The hand pointer is not the
macOS cursor, and the upstream board does not constrain the draggable assistant
ring to the viewport. No upstream source patch has been made. Reconsider a
permissioned display-only bridge only after the demo, an AGPL licensing review,
and a separate security and product-scope decision.
