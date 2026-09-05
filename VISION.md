# Agent Harbor vision

Status: accepted private-product direction as of August 30, 2026.

## Product promise

Agent Harbor is Laura's local-first control plane for a personal team of AI
workers. It makes agents useful without treating a model as the security
boundary. Laura chooses the agents, models, instructions, tools, information,
and execution environments; Agent Harbor owns the policies, approvals, limits,
and evidence surrounding their work.

Natural language is the primary control surface. Deterministic application code
remains the authority for what an agent may do.

## Product scope

Agent Harbor is a private personal application. It is optimized for Laura's
actual devices, agents, records, clients, and workflows. There is no planned
public or open-source Agent Harbor release. Public branding, contributor
onboarding, generalized support promises, and release marketing remain out of
scope unless Laura explicitly changes that decision.

The MIT license and OpenMausBot attribution are retained because they describe
the project's origin; they are not a public-launch commitment.

## The three-application ecosystem

Agent Harbor, Life OS, and the Jinx Memory System are separate applications.
Each must remain useful without the other two.

| Application | Owns | Does not own |
|---|---|---|
| Life OS | Projects, tasks, commitments, briefings, and attention | Agent execution policy or durable memory |
| Agent Harbor | Agents, models, instructions, tools, assets, rooms, environments, approvals, and run evidence | Life management or long-term personal knowledge |
| Jinx Memory System | Durable knowledge, preferences, relationships, history, retrieval, and sensitivity labels | Agent execution authority or operational commitments |

Jinx may eventually become Laura's Chief of Staff interface across the
ecosystem. In that role, Jinx can ask Life OS what needs attention, Jinx Memory
what context matters, and Agent Harbor which specialist should act. Jinx does
not become a fourth platform and cannot bypass Agent Harbor's policy engine.

## Principles

1. **Human authority is final.** Agents may propose and request; they cannot
   grant themselves authority or manufacture approval.
2. **The runtime is the security boundary.** Prompt instructions guide behavior
   but do not replace enforced policy.
3. **Useful autonomy is calibrated to risk.** Routine, reversible work can flow
   inside an approved scope. Consequential work pauses for a fresh decision.
4. **Every run leaves evidence.** Tasks, instructions, model choices, tool
   requests, approvals, results, costs, and failures remain understandable.
5. **Stable concepts use replaceable plumbing.** Models, providers, protocols,
   browsers, and execution environments are adapters rather than the product.
6. **Private state stays private.** Credentials, health records, client context,
   tuned specialists, sensitive prompts, and personal source material receive
   explicit protection.
7. **The applications remain independent.** Integrations use narrow APIs,
   events, references, and revocable identities rather than shared databases.
8. **Evidence outranks deadlines.** A capability is described as working only
   after the relevant path has actually been observed.

## Intended personal outcomes

Agent Harbor should let Laura:

- create distinct specialists such as Otto for veterinary research;
- choose or change a specialist's model without losing its identity;
- give agents scoped tools, assets, workspaces, and computer destinations;
- collaborate with several specialists while preserving their different roles;
- run approved work now or later without runaway cost or authority;
- see what happened, stop work, and recover when something fails; and
- maintain the system without having to understand every implementation detail.

## Non-goals

Agent Harbor is not:

- a single autonomous super-agent;
- Life OS, a CRM, or a general project-management system;
- a long-term knowledge base that replaces Jinx Memory;
- a credential dump handed to a model;
- a permission system implemented only through prompts;
- dependent on one model provider, cloud, protocol, or sandbox; or
- a public product with a contributor or support program.

## What success means

Success is not maximum autonomy. Success is a dependable personal system in
which routine work is easy, meaningful risk is visible, authority is bounded,
private information is protected, and Laura can understand, interrupt, back up,
restore, and roll back the system.

