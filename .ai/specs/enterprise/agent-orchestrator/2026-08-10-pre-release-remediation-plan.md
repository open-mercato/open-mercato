# Agent Orchestrator — Pre-Release Remediation Plan (umbrella)

**Date:** 2026-08-10 · **Source:** maintainer field notes captured after the pilot engagement (working file, not tracked).

The notes hold seventeen findings across two horizons: defects observed while the module was driven in anger during the pilot, and a set of **model-level changes the maintainer wants settled before Agent Orchestrator is released**. They are not one backlog. The model-level items (W1, W2) rewrite what a process *is*, so they should land before release; the rest are independent and can ship in any order beside them.

This umbrella sequences the work and names the questions that must be answered before W1 can start. It commissions no implementation on its own — each workstream lands as its own spec and PR, per the precedent set by [`2026-07-12-ux-remediation-plan.md`](./2026-07-12-ux-remediation-plan.md).

## The module is unreleased — reorganize freely

**Maintainer decision (2026-08-10): no deprecation protocol applies to Agent Orchestrator's own surfaces.** Verified against `origin/develop`:

| Surface | On `develop`? | Consequence |
|---|---|---|
| `packages/enterprise/src/modules/agent_orchestrator` (entire module) | absent | Its ACL ids, routes, tables, queues and event ids have never shipped. Rename, merge or delete them outright. |
| `INVOKE_AGENT` activity type, agent outcome routing, the disposition kinds | absent | Branch-only. The five disposition kinds and `resultKind` are free to rename, wire values included. |
| `SET_VARIABLE` activity type | absent | Branch-only. |
| core `workflows` `/backend/tasks` + the `workflows.tasks.list` tableId | **present** | The one genuinely released surface in this area. It already has a bridge redirect onto the Work Inbox and a frozen tableId the enterprise Caseload row action binds to — leave both intact. |

So the only backward-compatibility care in this plan is the last row. Everything else is a straight refactor: no bridges, no dual-accept, no `UPGRADE_NOTES.md` entries, no `@deprecated` shims.

This is also the argument for doing W1 and W2 **now** rather than after release. The reorganization is free today and expensive the moment the module ships — that timing, not any compatibility obligation, is what makes them release-gating.

## Findings → workstreams

| # | Finding (source note) | Workstream |
|---|---|---|
| 1 | Task is an external work order; drop the task/process split — one process wraps everything | **W1** Process/trigger model |
| 2 | A trigger may be external; retire the "tasks" vocabulary in favour of triggers | W1 |
| 3 | A process triggers internally, manually, or externally | W1 |
| 4 | A process may carry an agent **or** a workflow | W1 |
| 5 | A process declares milestones mapped onto workflow elements, rendered for a business reader | W1 |
| 6 | Workflows need not be displayed at all | W1 |
| 7 | A process should resolve to an object it produces — **unresolved** | W1 · gate **Q2** |
| 8 | Three agent types: Researcher (rename "Informative"), Decision-maker, Action agent | **W2** Agent taxonomy |
| 9 | The decision agent knows the statuses it may propose, bound to an entity, fetched via a tool | W2 |
| 10 | How an action agent actually executes — agent tool vs workflow-invoked — **unresolved** | W2 · gate **Q3** |
| 11 | Web Search settings expose two save buttons; one save point only | **W3** Settings & IA |
| 12 | Web Search belongs in Settings, not under Agents | W3 |
| 13 | Traces carries good information but shows more than a reader needs | W3 |
| 14 | Evals is unintuitive; the UX is the weakest surface in the module | **W4** Evals usability |
| 15 | Application RAM footprint is poor | **W5** Runtime footprint |
| 16 | Playground layout: Output belongs below the agent/input section, full width | W3 |
| 17 | File-agent directory tree renders flat on Windows — no folder drill-down | **W6** Windows file-agent tree |
| — | Process/definition authoring needs a wizard | **W7** Authoring wizard (depends on W1) |

## Workstreams

### W1 — Collapse task and process into one triggered process · **M–L**

Today the module ships both concepts: `AgentTaskDefinition` / `AgentTaskRun` with their own page at `backend/agentic-tasks/`, and a separate process projection at `backend/processes/`. The notes call for one process that wraps everything, entered by a trigger that may be internal, manual or external — the external trigger being what "task" means today.

Because nothing here has shipped, this is a rename-and-merge rather than a migration:

- `agent_orchestrator.tasks.{view,run,manage}` → the trigger/process vocabulary, renamed in place.
- `/backend/agentic-tasks` folds into the process surface; no bridge route needed.
- `AgentTaskDefinition` / `AgentTaskRun` merge into the process entities. Squash the module's migrations rather than stacking an alter-heavy chain on tables no deployment holds — see the snapshot note under W4 before touching this module's migrations.
- Task queues and `agent_orchestrator.task_run.*` events rename with everything else.

**Also in scope:** milestone declarations mapped onto workflow elements, with a business-reader view; and hiding the workflow surface behind that view rather than deleting it (finding 6 is a display decision, not a capability removal — the engine still needs the definition).

**Explicitly parked:** what object a process resolves to (gate **Q2**). W1 cannot close the model while that is open, so the first spec carries the structure and leaves the binding as a follow-up field.

**The one thing not to break:** core `workflows` keeps `/backend/tasks`, its bridge redirect and the frozen `workflows.tasks.list` tableId. W1 renames the *enterprise* task concept, not the core user-task one.

### W2 — Three agent types · **M**

The module currently distinguishes agents by `resultKind: 'informative' | 'actionable'` (`data/validators.ts:94`) and dispositions by five kinds, of which `informative` is one (`data/validators.ts:29,36`). All branch-only, so rename the wire values along with the labels — no dual-accept, no compatibility window.

- **Researcher** — rename `informative` throughout: disposition kind, `resultKind`, i18n labels, and the outcome-routing handle in core workflows (`lib/outcome-routing.ts`, also branch-only).
- **Decision-maker** — new. Needs the entity binding and status list the notes describe, fetched through a read-only tool so the option set is proven rather than prompted. The proposal names a target status; the deterministic application stays server-side, which is the existing propose-only contract rather than an exception to it.
- **Action agent** — new, and the one that genuinely changes the module's security posture: it is the first agent type whose purpose is to cause an effect. Gate **Q3** decides the mechanism, and the answer must hold the propose-only line — see the cross-cutting rules below.

### W3 — Settings, information architecture and surface trimming · **S–M** · independent

- Web Search moves from `backend/web-search/` into the settings area, and its two save affordances collapse to one.
- Playground: Output moves below the agent/input section at full width.
- Traces: decide what a reader needs and hide the rest.

Fold in, since these files are being opened anyway:

- The Traces detail view renders raw tool arguments, and the model is instructed to pass `_sessionToken` on every call — so a live credential can reach a surface `trace.view` grants to `employee` by default. Key-level redaction belongs in this pass.
- Web Search carries `allowPrivateHosts` as a tenant-writable setting and stores adapter API keys unencrypted in `module_configs`. Moving the surface is the moment to fix both.
- The module's UI accounts for the bulk of the repo's outstanding design-system warnings (raw `<table>` markup, missing loading/empty states). A DS pass on the touched pages is cheap here and expensive later.

### W4 — Evals usability · **M** · independent

Called out as the weakest surface in the module. Treat as a UX rework of `backend/eval-cases/` and `backend/eval-runs/`, scoped by an audit rather than by guesswork — the eight-auditor format used for the July UX audit is the precedent and produced actionable output.

Carry one known defect into this workstream: the `agent_orchestrator` migration snapshot does not record `agent_eval_case_runs`, `agent_eval_suite_runs`, `agent_eval_results.eval_case_run_id`, `agent_proposals.source` or `agent_runs.source`, so the next `yarn db:generate` for this module emits non-idempotent `create table` / `add column` statements that fail on any database that already ran those migrations. Since the module is unreleased, the cheapest fix is to squash its migrations to a single current-state migration and regenerate the snapshot from it — which W1 wants to do anyway.

### W5 — Runtime footprint · **M** · independent

Existing precedent to build on rather than restart: [`2026-05-27-dev-mode-memory-quick-wins.md`](../../2026-05-27-dev-mode-memory-quick-wins.md) and [`2026-05-13-frontend-client-boundary-ram-reduction.md`](../../2026-05-13-frontend-client-boundary-ram-reduction.md), plus `scripts/profile-dev-rss.mjs`. Start by measuring against those baselines and reporting the delta; "RAM is bad" is not yet a scoped task.

### W6 — Windows file-agent directory tree · **S** · independent

The file-defined agent browser renders a flat list on Windows with no folder drill-down. Almost certainly a path-separator assumption in the tree builder. Small, self-contained, and worth shipping early because it blocks a whole platform's authors.

### W7 — Process authoring wizard · **M** · depends on W1

A guided path to a process definition. Cannot be specified before W1 fixes what a process is, so this trails the model change deliberately.

## Open questions — resolve before W1/W2 specs are written

| Q | Question | Why it blocks |
|---|---|---|
| **Q1** | Are milestones a first-class stored declaration on the process, or a projection derived from workflow steps? | Stored means a schema change and an editor; derived means neither. |
| **Q2** | What object does a process resolve to, and is that binding required or optional? | The notes leave this open. W1's model cannot be closed without it. |
| **Q3** | Does an action agent get a mutating tool, or does the workflow invoke the action from the run context? | Decides whether the module keeps its propose-only guarantee (see below). Highest-stakes question here. |
| **Q4** | If workflows are not displayed, is the workflow editor still reachable for authors, or is the process view the only entry? | Determines whether W1 hides a surface or retires one. |

*(The two questions an earlier draft raised about vocabulary scope and label-vs-wire renaming are closed by the maintainer decision above: rename everything, wire values included.)*

## Cross-cutting rules

- **Q3 must not be answered by giving the model a mutating tool.** The module's propose-only guarantee currently rests on a generated read-only allowlist plus the per-run session-token ACL; it is not enforced by an independent server-side check, so a mutating tool in the allowlist is the whole boundary. Whichever mechanism wins, the effect should be executed deterministically server-side from a proposal, with the model naming the action and never invoking it. If W2 lands before that enforcement gap is closed, it widens a hole rather than adding a feature. Being unreleased removes the compatibility cost of this decision — it does not remove the security cost.
- Every workstream lists integration coverage for its affected API and UI paths and ships those tests in the same change (root `AGENTS.md`).
- Renames are free **within** `agent_orchestrator` and the branch-only workflow surfaces (`INVOKE_AGENT`, `SET_VARIABLE`, disposition kinds, outcome routing). They are not free in core `workflows` surfaces that predate this branch — `/backend/tasks`, its bridge redirect and the `workflows.tasks.list` tableId stay as they are.
- Copy changes land in all four locales; the neutral-vocabulary contract from the July consistency pass stays in force — the new type names must not reintroduce domain-specific language.
- W1 and W7 are one train: W7 assumes W1's model. W3, W4, W5 and W6 are independently orderable and are the sensible first PRs while the gate runs.

## Suggested order

1. **Run the gate** (Q1–Q4). Nothing in W1/W2 is specifiable until Q2 and Q3 have answers.
2. **W6**, then **W3** — smallest, independent, and W3 carries three security/DS fixes that are cheap while those files are open.
3. **W4** (audit first, then rework) and **W5** (measure first) in parallel with the gate.
4. **W1** — including the migration squash — then **W2**, then **W7**.

## Changelog

- **2026-08-10**: Umbrella created from the pilot field notes; seventeen findings mapped to seven workstreams.
- **2026-08-10**: Maintainer correction — Agent Orchestrator has never been released, so no deprecation protocol applies to its own surfaces. Verified against `origin/develop`: the module, `INVOKE_AGENT`, `SET_VARIABLE` and the disposition kinds are all absent there; only core `workflows`' `/backend/tasks` and `workflows.tasks.list` are genuinely shipped. W1 resized from a compatibility migration to a straight refactor (plus a migration squash); the two BC-driven gate questions dropped; the release-gating argument restated as "free now, expensive after release".
