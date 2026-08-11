# Agent Orchestrator — Pre-Release Remediation Plan (umbrella)

**Date:** 2026-08-10 · **Source:** maintainer field notes captured after the pilot engagement (working file, not tracked).

The notes hold seventeen findings across two horizons: defects observed while the module was driven in anger during the pilot, and a set of **model-level changes the maintainer wants settled before Agent Orchestrator is released**. They are not one backlog. The model-level items (W1, W2) rewrite what a process *is*, so they should land before release; the rest are independent and can ship in any order beside them.

This umbrella sequences the work and records the design decisions taken at the gate. It commissions no implementation on its own — each workstream lands as its own spec and PR, per the precedent set by [`2026-07-12-ux-remediation-plan.md`](./2026-07-12-ux-remediation-plan.md).

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
| 5 | A process declares milestones mapped onto workflow elements, rendered for a business reader | W1 · **resolved** (Q1, stored) |
| 6 | Workflows need not be displayed at all | W1 · **resolved as no change** (Q4) |
| 7 | A process should resolve to an object it produces | W1 · **resolved** (Q2, optional) |
| 8 | Three agent types: Researcher (rename "Informative"), Decision-maker, Action agent | **W2** Agent taxonomy |
| 9 | The decision agent knows the statuses it may propose, bound to an entity, fetched via a tool | W2 |
| 10 | How an action agent actually executes | W2 · **resolved** (Q3, propose-only) |
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

**Milestones (Q1 — stored).** An ordered `milestones` declaration on the process definition, each entry carrying its own id, business-facing label and the workflow step it maps to, plus an editor to manage them. Two consequences to design for:

- A milestone pointing at a step the workflow no longer declares must surface as a Problems-panel warning, not a silent gap. The workflows module already has this shape for unknown outcome kinds and quarantined step config — reuse it rather than inventing a new diagnostic.
- Because the label is authored on the process rather than read from the step, renaming a step no longer changes what the business reader sees. That is the point of the decision, and it is also the maintenance cost: the mapping is now a thing that can drift, so the warning above is load-bearing.

**Outcome (Q2 — optional).** A nullable outcome reference written when the process completes, mirroring the existing `subject*` shape (`outcomeType` / `outcomeId` / `outcomeLabel`). Optional by decision, so a process that produces nothing stays valid. Additive and free to tighten later.

**Workflow visibility (Q4 — unchanged).** W1 does not hide or gate any workflow surface. The milestone view is what a business reader gets; everyone with the module keeps the Studio exactly as it is today.

**The one thing not to break:** core `workflows` keeps `/backend/tasks`, its bridge redirect and the frozen `workflows.tasks.list` tableId. W1 renames the *enterprise* task concept, not the core user-task one.

### W2 — Three agent types · **M**

The module currently distinguishes agents by `resultKind: 'informative' | 'actionable'` (`data/validators.ts:94`) and dispositions by five kinds, of which `informative` is one (`data/validators.ts:29,36`). All branch-only, so rename the wire values along with the labels — no dual-accept, no compatibility window.

- **Researcher** — rename `informative` throughout: disposition kind, `resultKind`, i18n labels, and the outcome-routing handle in core workflows (`lib/outcome-routing.ts`, also branch-only).
- **Decision-maker** — new. Needs the entity binding and status list the notes describe, fetched through a read-only tool so the option set is proven rather than prompted. The proposal names a target status; the deterministic application stays server-side, which is the existing propose-only contract rather than an exception to it.
- **Action agent** — new, and the one that genuinely changes the module's security posture: it is the first agent type whose purpose is to cause an effect. **Per Q3 it stays propose-only:** the agent emits a proposal naming the action and its arguments, disposition approves it (auto-threshold or human), and the workflow performs the effect deterministically.

  The action vocabulary should be the effects the platform can already run under its own gates — the safe-command catalogue behind `UPDATE_ENTITY` (declared in code, switched on per tenant, checked against the actor's features) and the existing workflow activity types such as `SEND_EMAIL` and `EMIT_EVENT`. Reusing them means an action agent introduces **no new effect surface**: everything it can cause was already reachable, already gated, and already tested. Inventing a separate effect registry for agents would recreate those gates in a second place, which is how they drift apart.

  The model never receives a mutating tool, so this decision does not depend on the missing server-side non-mutating check — but it does not fix that gap either; see the cross-cutting rules.

### W3 — Settings, information architecture and surface trimming · **S–M** · independent

- Web Search moves from `backend/web-search/` into the settings area, and its two save affordances collapse to one. ✅ shipped
- Playground: Output moves below the agent/input section at full width. ✅ shipped
- Traces: five specific fixes, below. ✅ shipped (`e6b6c627b`)

Fold in, since these files are being opened anyway:

- Web Search carries `allowPrivateHosts` as a tenant-writable setting and stores adapter API keys unencrypted in `module_configs`. Moving the surface is the moment to fix both.
- The module's UI accounts for the bulk of the repo's outstanding design-system warnings (raw `<table>` markup, missing loading/empty states). A DS pass on the touched pages is cheap here and expensive later.

#### Traces — targeted fixes, not a redesign

An earlier draft of this plan claimed the trace detail was "seven equal-weight cards in storage order" and proposed three competing redesigns. **That was wrong**, and the mistake is worth recording: the page structure was inferred by grepping i18n keys and section names out of the source instead of rendering it. The real page already leads with a verdict (status, `Gated to human`, confidence), carries an 8-tile KPI grid, an execution timeline, evaluation results, collapsible per-call tool rows with copy, a JSON tree for the output, and honest empty states. Two of the three proposed "directions" were largely already built. The prototype was deleted rather than left to mislead.

What the rendered page actually needs, each observed directly:

1. **The execution timeline axis is linear.** `buildTimeline` (`backend/traces/[id]/page.tsx`) computes one `startMs`/`totalMs` and positions every bar as a fraction of it, so on a 463s run seven of eight spans collapse into sub-pixel dots at the left edge and the timeline shows nothing. `workflows` already solved exactly this with a **piecewise-linear** axis (`lib/run-gantt.ts`: a slice past a derived threshold renders at threshold width and is flagged, while `durationMs` keeps its true value). Adopt that, do not re-invent it.
2. **Span labels truncate at the wrong end.** Rows read `open-mercato_lighthou…` six times over; the distinguishing part of a tool span is its suffix (`bos_cumulation`, `vademecum`, `deductible_config`), which is precisely what is cut. Truncate the middle or the prefix.
3. **The rationale renders twice, verbatim.** The Reasoning card and `proposal.rationale` inside Output are the same text. Pick one home.
4. **Empty cards cost a full row.** Guardrails and Context assembled each render a card to say nothing was recorded. Collapse or omit when empty — the honest-degradation copy is right, the footprint is not.
5. **Two of eight KPI tiles are dead on the OpenCode runtime.** `TOKENS` and `COST (EST.)` both show `—`. Either derive them for that runtime or drop the tiles when the runtime cannot supply them.

The session-token leak that was also on this list is **fixed** (redacted at trace ingestion, so the credential reaches neither the row nor the artifact store). Note it is ingestion-time only: traces captured before the fix still render the token.

### W4 — Evals usability · **M** · independent

Called out as the weakest surface in the module. Treat as a UX rework of `backend/eval-cases/` and `backend/eval-runs/`, scoped by an audit rather than by guesswork — the eight-auditor format used for the July UX audit is the precedent and produced actionable output.

Carry one known defect into this workstream: the `agent_orchestrator` migration snapshot does not record `agent_eval_case_runs`, `agent_eval_suite_runs`, `agent_eval_results.eval_case_run_id`, `agent_proposals.source` or `agent_runs.source`, so the next `yarn db:generate` for this module emits non-idempotent `create table` / `add column` statements that fail on any database that already ran those migrations. Since the module is unreleased, the cheapest fix is to squash its migrations to a single current-state migration and regenerate the snapshot from it — which W1 wants to do anyway.

### W5 — Runtime footprint · **M** · independent

Existing precedent to build on rather than restart: [`2026-05-27-dev-mode-memory-quick-wins.md`](../../2026-05-27-dev-mode-memory-quick-wins.md) and [`2026-05-13-frontend-client-boundary-ram-reduction.md`](../../2026-05-13-frontend-client-boundary-ram-reduction.md), plus `scripts/profile-dev-rss.mjs`. Start by measuring against those baselines and reporting the delta; "RAM is bad" is not yet a scoped task.

### W6 — Windows file-agent directory tree · **S** · independent · ✅ **shipped** (`c7c117715`)

The file-defined agent browser rendered a flat list on Windows with no folder drill-down. It was a path-separator assumption, in two producers rather than one: `computeAgentTokenUsage.ts` and its CLI mirror both emitted native separators, and the tree builder split on `/` only. Both producers now normalize through `toPosixRelativePath`, and the builder splits on `/[\\/]+/` so a path that slipped through either way still nests. Regression coverage: `__tests__/file-tree-separators.test.ts`.

### W7 — Process authoring wizard · **M** · depends on W1

A guided path to a process definition. Cannot be specified before W1 fixes what a process is, so this trails the model change deliberately.

## Decisions locked at the gate (2026-08-10)

| Q | Decision |
|---|----------|
| **Q1** milestones | **First-class stored declaration on the process definition**, each entry mapped to a workflow step. Costs a field and an editor; buys business-facing names that are independent of step labels and survive a step being renamed. |
| **Q2** process outcome | **Optional outcome reference** — a nullable type+id (+ label snapshot) the process writes on completion, mirroring the existing `subject*` fields. Not required, so research and monitoring processes stay valid. |
| **Q3** action agent | **Propose only; the workflow executes.** The agent names the action and its arguments in a proposal; disposition approves (auto-threshold or human); the effect runs deterministically server-side through the existing gated path. No mutating tool reaches the model. |
| **Q4** workflow visibility | **Leave the Studio fully visible — no gating.** Agent Orchestrator is an enterprise module behind an opt-in flag, so only a subset of tenants ever see any of this surface; hiding workflows inside it would add an ACL axis for no audience. Finding 6 is satisfied by giving the business reader the milestone view, not by removing the workflow view from anyone. |

*(Two questions an earlier draft raised — vocabulary scope, and label-vs-wire renaming — are closed by the unreleased-module decision above: rename everything, wire values included.)*

## Cross-cutting rules

- **The propose-only enforcement gap is still open, and Q3 does not close it.** The guarantee rests on a generated read-only allowlist plus the per-run session-token ACL, with no independent server-side check that a running agent can only call non-mutating tools. Q3 keeps mutating tools away from the model, so W2 does not *widen* that gap — but a file-defined agent declaring a mutating tool remains bounded only by the allowlist. Closing it (blocker B1 in the PR risk review) stays required before release, independently of this plan.
- Every workstream lists integration coverage for its affected API and UI paths and ships those tests in the same change (root `AGENTS.md`).
- Renames are free **within** `agent_orchestrator` and the branch-only workflow surfaces (`INVOKE_AGENT`, `SET_VARIABLE`, disposition kinds, outcome routing). They are not free in core `workflows` surfaces that predate this branch — `/backend/tasks`, its bridge redirect and the `workflows.tasks.list` tableId stay as they are.
- Copy changes land in all four locales; the neutral-vocabulary contract from the July consistency pass stays in force — the new type names must not reintroduce domain-specific language.
- W1 and W7 are one train: W7 assumes W1's model. W3, W4, W5 and W6 are independently orderable and are the sensible first PRs while the gate runs.

## Suggested order

The gate is closed, so W1 and W2 are specifiable now.

1. **W6**, then **W3** — smallest and independent, and W3 carries three security/DS fixes that are cheap while those files are open.
2. **W4** (audit first, then rework) and **W5** (measure first) — independent, run in parallel.
3. **W1** — including the milestone declaration, the optional outcome reference and the migration squash — then **W2**, then **W7**.
4. Close the propose-only enforcement gap (B1) before release, on its own track.

## Status at 2026-08-11

| Workstream | State |
|---|---|
| **W1** process/trigger model | not started — specifiable now, gate closed |
| **W2** agent taxonomy | not started — follows W1 |
| **W3** settings & IA | Web Search move, single save point, Playground layout and the five Traces fixes **shipped**. **Open:** `allowPrivateHosts` as a tenant-writable setting, adapter API keys stored unencrypted in `module_configs`, and the DS pass on the touched pages. |
| **W4** evals usability | not started — audit first. Carries the migration-snapshot defect. |
| **W5** runtime footprint | not started — measure first |
| **W6** Windows file tree | **shipped** |
| **W7** authoring wizard | not started — blocked on W1 |
| **B1** propose-only enforcement | not started — **release-gating**, on its own track |

Two fixes landed on this branch that were NOT plan items — both came from maintainer screenshots rather than the pilot notes, and both are recorded here only so the branch's scope is legible: the workflow AI drafter could not reach its own validation tool and had no repair loop (`2aeca0457`), and the overview's web-search card became one system-health tile covering web search, MCP, OpenCode and the OpenCode → MCP binding (same commit).

## Changelog

- **2026-08-10**: Umbrella created from the pilot field notes; seventeen findings mapped to seven workstreams.
- **2026-08-10**: Traces item rewritten against the rendered page after the maintainer showed screenshots. The earlier reading was derived from source greps rather than the running UI and was wrong on nearly every point — the page already leads with a verdict, has an execution timeline and collapsible tool calls, and two of the three proposed redesigns were largely shipped. The exploratory prototype was deleted; W3 now carries five specific, observed fixes (linear timeline axis, label truncation, duplicated rationale, empty cards, dead KPI tiles). W3's Web Search and Playground items shipped in `c7c117715`; the session-token leak is fixed at ingestion in the same commit.
- **2026-08-10**: Gate closed. Q1 milestones = stored on the process definition (against the drafted recommendation — the maintainer wants business names independent of step labels; a drift warning becomes load-bearing as a result). Q2 outcome = optional reference mirroring `subject*`. Q3 action agent = propose-only, executing through the existing safe-command and activity gates so no new effect surface is created. Q4 = leave the Studio fully visible; Agent Orchestrator is enterprise and flag-gated, so hiding workflows inside it would add an ACL axis for no audience, and finding 6 is satisfied by the milestone view instead. W1 resized upward for the milestone editor; the "hide workflows" sub-item dropped.
- **2026-08-10**: Maintainer correction — Agent Orchestrator has never been released, so no deprecation protocol applies to its own surfaces. Verified against `origin/develop`: the module, `INVOKE_AGENT`, `SET_VARIABLE` and the disposition kinds are all absent there; only core `workflows`' `/backend/tasks` and `workflows.tasks.list` are genuinely shipped. W1 resized from a compatibility migration to a straight refactor (plus a migration squash); the two BC-driven gate questions dropped; the release-gating argument restated as "free now, expensive after release".
- **2026-08-11**: W6 marked shipped and its root cause recorded (two producers emitting native separators, not one). W3's Traces item marked shipped. Status table added — W3 retains three open items (tenant-writable `allowPrivateHosts`, unencrypted adapter keys, DS pass); W1, W2, W4, W5, W7 and B1 are untouched.
