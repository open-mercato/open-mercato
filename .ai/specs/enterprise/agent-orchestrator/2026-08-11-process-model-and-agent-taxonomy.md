# Process Model and Agent Taxonomy (W1 + W2) — SKELETON

**Date:** 2026-08-11 · **Status:** skeleton, awaiting the Open Questions gate
**Umbrella:** [`2026-08-10-pre-release-remediation-plan.md`](./2026-08-10-pre-release-remediation-plan.md) — workstreams W1 and W2
**Scope:** enterprise (`packages/enterprise/src/modules/agent_orchestrator`), plus branch-only surfaces in core `workflows`

## TLDR

W1 collapses the module's task and process concepts into one **triggered process**, entered internally, manually or externally, carrying either an agent or a workflow, declaring business-facing milestones and optionally resolving to an object it produces. W2 replaces the two-way `resultKind` split with three named agent types — **Researcher** (renamed from `informative`), **Decision-maker** and **Action agent** — all propose-only.

The module is unreleased (verified against `origin/develop`), so both are straight refactors: wire values renamed, migrations squashed, no bridges or deprecation shims. The one surface that must not move is core `workflows`' `/backend/tasks`, its bridge redirect and the frozen `workflows.tasks.list` tableId.

---

## Open Questions — **gate: nothing below is written until these are answered**

**Q1. One spec or two?** W1 and W2 are independently deployable — W2's rename and two new agent types need no part of W1's model change, and W1 works with today's two result kinds. The plan sequences them (W2 "follows W1") but does not couple them. Splitting gives two shippable PRs and two independent review surfaces; keeping them together documents one vocabulary change once.
  **(a)** Two specs — `…-triggered-process-model.md` and `…-agent-taxonomy.md`, cross-referenced *(recommended)*
  **(b)** One spec, two phases

**Q2. Task and process are not the same kind of thing — which becomes which?** This is the question that decides the data model, and the plan's wording ("merge `AgentTaskDefinition`/`AgentTaskRun` into the process entities") reads as if they were peers. They are not:
  - `agent_task_definitions` is a **definition** — name, `target_type` (`agent`|`workflow`), input schema, execution principal, granted features, cron. `agent_task_event_triggers` already gives it external event entry.
  - `agent_processes` is a **projection** — a read model rebuilt from events by `lib/processes/agentProcessProjection.ts`, holding a live workflow instance's status, subject, counters and assignee. It has no authored fields at all.

  So "one process" must become **two** records, not one:
  **(a)** `ProcessDefinition` (from `AgentTaskDefinition` + triggers) and `ProcessRun` (from `AgentTaskRun`, with `AgentProcess` staying a projection over it) *(recommended — it is what the code already is)*
  **(b)** Fold the projection's fields onto the run row and drop the projection
  **(c)** Something else — please describe

**Q3. Is "agent type" a new declared field, or is it derived from the result contract?** Three types map onto two existing result kinds: Researcher returns `informative`; both Decision-maker and Action agent return `actionable`, differing only in what the proposal names (a target status vs an action + arguments).
  **(a)** A declared `agentType` on the agent definition; `resultKind` stays the wire contract and is derived from it *(recommended — the type is an authoring fact, the result kind is a runtime one)*
  **(b)** Extend the `resultKind` union to three, dropping the separate concept
  **(c)** Derive the type from the proposal's shape at runtime; declare nothing

**Q4. Does `informative` get renamed everywhere, or only in labels?** *(Pre-answered by the umbrella's locked decision — "rename everything, wire values included" — so this is stated for confirmation rather than asked. Say so if the core reach changes your answer.)* The plan says rename wire values too, and the unreleased-module decision permits it. The blast radius is larger than the module: the `agentResultSchema` discriminated union (`data/validators.ts:29-36`), the `resultKind` list-filter enum, `agent_runs.result_kind` rows, and **core workflows' disposition kinds and outcome routing** (`lib/outcome-routing.ts:50,215`) — the last of which is branch-only but is core, not enterprise.
  **(a)** Rename everywhere including the core `workflows` disposition kind *(recommended, and the plan's stated intent)*
  **(b)** Rename in `agent_orchestrator` only; leave the core disposition kind `informative`

**Q5. What is an Action agent allowed to name?** Q3 of the gate settled that it proposes and the workflow executes. It did not settle the vocabulary. The plan suggests reusing the safe-command catalogue behind `UPDATE_ENTITY` plus existing activity types (`SEND_EMAIL`, `EMIT_EVENT`) so no new effect surface is created.
  **(a)** Exactly the existing safe-command catalogue + the existing activity types, nothing else *(recommended)*
  **(b)** A separate, narrower per-agent allowlist authored on the agent definition
  **(c)** Both — the catalogue bounds it, a per-agent allowlist narrows it further

**Q6. Do milestones ship in W1, or trail it?** *(Leaning (a) on the strength of the umbrella's Q1, which made milestones first-class. Stated for confirmation.)* Q1 of the gate settled that milestones are a stored, ordered declaration on the process definition, each mapped to a workflow step, with an editor and a Problems-panel warning when a mapping goes stale. That is a meaningful slice of its own — a field, an editor, a validator and a diagnostic.
  **(a)** Ship with W1 — the model change and its business-facing view land together *(recommended)*
  **(b)** W1 lands the model; milestones follow as their own phase or spec

---

## What the skeleton already asserts (independent of the answers)

These are settled by the umbrella's gate or verified in code, and will not change with Q1–Q6:

- **No deprecation protocol.** The module is absent from `origin/develop`; ACL ids, routes, tables, queues and event ids have never shipped. No bridges, no dual-accept, no `UPGRADE_NOTES.md` entries.
- **The one frozen surface.** Core `workflows` keeps `/backend/tasks`, its bridge redirect and the `workflows.tasks.list` tableId. W1 renames the *enterprise* task concept only.
- **Migrations are squashed, not stacked.** The module's snapshot already fails to record five tables/columns, so `yarn db:generate` emits non-idempotent DDL today. A single current-state migration plus a regenerated snapshot is cheaper than an alter chain on tables no deployment holds — and fixes the W4 defect in passing.
- **Action agents create no new effect surface.** Whatever Q5 settles, the model never receives a mutating tool; the effect runs server-side through the existing gated path.
- **The propose-only enforcement gap (B1) is not closed by this work.** It remains release-gating on its own track. W2 must not be read as having addressed it.
- **`target_type` already exists.** `agent_task_definitions.target_type` is `agent`|`workflow`, so the umbrella's finding 4 ("a process may carry an agent **or** a workflow") is largely built. W1 renames and re-homes it rather than designing it.

## Sections to be written after the gate

Problem statement · Proposed model (entities, wire contracts, events) · Trigger taxonomy (internal / manual / external) · Milestone declaration and drift diagnostic · Agent taxonomy and the propose-only contract · Migration squash and snapshot regeneration · UI surfaces and the Frontend Architecture Contract · Phasing and steps · Integration coverage per API and UI path · Risks and rollback
