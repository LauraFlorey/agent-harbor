> Public-source preparation: the owner has approved preparing Agent Harbor for a public repository. Personal data and integrations remain private. Earlier private-product language below records the original design direction; release gates are in [docs/release-readiness.md](docs/release-readiness.md).

# Agent Harbor vision

Status: accepted private-product direction as of August 30, 2026; Jinx/Discord
boundary updated September 14, 2026.

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

## Ecosystem

Agent Harbor is the **control plane**: rooms, bots, tasks, policy, and computer
destinations. It must remain useful with Discord, Jinx, and Life OS all absent.

**Jinx** is a working relationship Laura has on **Discord**. She is not a Harbor
surface, not a reserved bot name, and not a memory API this repository should
grow. The in-app **Chief of Staff** is a generic local coordinator for the
workspace team. It is not Jinx and must not be renamed or wired to Discord.

**Life OS** remains a possible *separate* companion app (calendar, todos,
knowledge). It is not the next sprint and does not imply a Jinx Memory service
inside Harbor. If it exists later, Harbor would consume narrow APIs — it would
not embed Life OS UI or share a database.

| Surface | Owns | Does not own |
|---|---|---|
| Agent Harbor | Agents, models, instructions, tools, assets, rooms, environments, approvals, and run evidence | Discord, Jinx, life management, or a long-term personal knowledge product |
| Discord + Jinx | The working relationship with Jinx | Agent execution policy, computer destinations, or Harbor state |
| Life OS (possible, later) | Projects, commitments, briefings, and attention | Agent execution authority |

Facts Jinx already knows reach Harbor only when Laura pastes or files them.
Pasted Discord content is evidence, not execution authority.

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
7. **Harbor remains independent.** Optional later companions use narrow APIs,
   events, references, and revocable identities rather than shared databases.
   Discord and Jinx stay out of this repository.
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
- a Discord client, Jinx bot, or Jinx Memory API;
- a long-term knowledge base or Life OS inside this app;
- a credential dump handed to a model;
- a permission system implemented only through prompts;
- dependent on one model provider, cloud, protocol, or sandbox; or
- a public product with a contributor or support program.

## What success means

Success is not maximum autonomy. Success is a dependable personal system in
which routine work is easy, meaningful risk is visible, authority is bounded,
private information is protected, and Laura can understand, interrupt, back up,
restore, and roll back the system.

