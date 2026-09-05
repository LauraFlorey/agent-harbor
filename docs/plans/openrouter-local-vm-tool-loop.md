# Sprint: OpenRouter Local VM tool loop

## Outcome

An Agent Harbor bot using an OpenRouter model can operate the isolated Local
VM through Cua Driver while preserving the same destination boundaries,
approval cards, interruption behavior, and audit trail used by the CLI and ACP
engines.

This sprint is complete only when the model can inspect and operate a browser
inside the Local VM. Text chat alone, a mocked tool response, or a model that
can merely describe intended clicks does not meet the outcome.

## Current checkpoint

Stories 1–6 and the first Local VM acceptance repair are implemented in the
history leading to local personal-use checkpoint `29a679a` on branch
`codex/personal-action-capabilities`. That branch also includes bounded
OpenRouter web research, one routine-action approval per attended task, doubled
operational time limits, per-agent system instructions, and the model-picker
mouse-scroll repair. The private branch is pushed at documentation checkpoint
`4403d90`; it is not merged into private `main`, installed as a promoted
personal checkpoint, or recovery-tested. No public release is planned.

Automated verification and the core development runtime are green. An earlier
controlled run at `cf11c7c` proved one complete approval-gated Local VM tool
call, but the full controlled acceptance sequence below remains incomplete. A
later turn reported **“Local VM lease ended before the turn completed.”** That
failure remains an unresolved acceptance risk and must not be hidden by the
new time limits.

## Scope

### In scope

- A provider-neutral, server-owned tool loop for API-backed model engines.
- OpenRouter Chat Completions tool declarations and streamed tool calls.
- Cua Driver tools from the explicitly selected Local VM.
- Existing Agent Harbor approval-card surface with an application-owned,
  task-scoped routine-action grant. Consequential calls retain fresh
  one-attempt approval, and unattended work never inherits Auto mode.
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

**Initial checkpoint:** no mutating tool reached the MCP server before an allow
decision; denial, timeout, and interruption all prevented execution. The later
personal-use policy narrows the distinction to routine versus consequential
actions while preserving the same application-owned gate.

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
- Connect application-owned approval, bounded product states, immediate preview
  refresh with polling fallback, one-lease lifecycle, provider-neutral
  continuation, and a global-switch rollback.
- Document that passwords, MFA, CAPTCHAs, and other protected input are
  completed manually in the visible Local VM and remain outside prompts.

**Checkpoint:** an explicitly enabled direct Terra agent can use the ready
Local VM only after current metadata verification and application-owned
decisions. Ineligible models remain text-capable, and disabling the global
switch cancels and drains active OpenRouter Local VM turns without changing
stored settings.

## Acceptance test

Use a controlled test webpage rather than a live social account for automated
checks and personal checkpoint verification.

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
personal-checkpoint tests use a controlled page rather than a live social account.

## Definition of done

- All six story checkpoints pass.
- Existing engine behavior and approval tests remain green on Laura's current
  target platform; other platforms are recorded honestly when unverified.
- The source or package smoke check for Laura's selected target passes.
- No credentials, tool arguments containing secrets, or raw screenshots enter
  native provider logs.
- Documentation states the supported destinations and model limitations.
- The feature remains globally and per-agent default-off behind capability
  checks. Personal-readiness claims wait for the complete acceptance test; an
  owner-enabled development checkpoint must not be described as an accepted
  personal capability until the evidence exists.

## Roadmap after Story 6

### Personal-use simplification

The app remains owner-controlled without removing existing access. OpenRouter
agents gain bounded provider-hosted public-web research independently of the
Local VM. An attended Local VM task asks once for routine actions, while every
consequential action still asks separately; a new task has no inherited grant.
Auto mode may pre-authorize only attended routine actions. Operational defaults
are 20 minutes per turn, 10 minutes for approval, 90 seconds per call after
approval, 20 seconds per MCP request, and 30 seconds per execution. Each agent
also has independent owner-authored system instructions in Settings, including
when it participates in an existing multi-agent room.

These additions do not alter existing providers, model choices, rooms,
connected apps, host/cloud destinations, or stored permissions. OpenRouter web
research does not authorize computer use, and the Terra Local VM allowlist
remains separate from ordinary OpenRouter text chat.

### Now — complete controlled acceptance

The first live approval-gated inspection passed on August 24, 2026: the Terra
test agent requested `get_accessibility_tree`, the owner approved the request, the
tool ran inside the isolated Local VM, and the agent returned a description of
the visible desktop. Automated tests, type checking, cleanup verification, and
the final security review also passed at checkpoint `cf11c7c`.

This proves the provider, approval, MCP, execution, and final-response path. It
does not complete the full acceptance test above. Continue with one controlled
step at a time:

1. Make the harmless test page reachable only for the isolated test workflow.
2. Verify visible-content inspection, then separately verify click, scroll, and
   harmless form typing after one routine-task approval.
3. Verify a consequential mock action cannot execute before approval.
4. Verify interruption, restart cleanup, Computer Off, and global-switch
   rollback exactly as listed in the acceptance test.
5. Run the source or package smoke check on Laura's current target and record
   every other platform as unverified and outside the present personal scope.

Stop and re-evaluate before adding another compatibility repair if the live
path exposes a new architectural failure after the successful checkpoint.

The current acceptance run must also verify the personal-use additions without
conflating them with Local VM authority:

- bounded public-web research works for an ordinary OpenRouter text turn and
  does not acquire a Local VM lease;
- one explicit attended-task decision covers only routine Local VM actions for
  that task, while a consequential mock action still pauses separately;
- the 20-minute turn, 10-minute approval, 90-second post-approval call,
  20-second MCP request, and 30-second execution limits remain bounded by the
  original monotonic turn deadline; and
- per-agent system instructions apply in direct and room conversations without
  rewriting provider, model, permission, connected-app, or destination
  settings.

### Next — preserve and review the personal checkpoint

- Keep the exact implementation and documentation commits identifiable until
  the complete acceptance record is reviewed.
- Update the personal status only after every required acceptance item is
  observed, not merely configured or tested with fixtures.
- Merge to private `main`, package when useful, install, and promote as distinct
  owner-approved steps after an explicit review of branch scope, rollback,
  backup, recovery, and the acceptance record. See
  [Private installation, packaging, and recovery](../deployment.md).
