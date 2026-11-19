# Agent Orchestrator — Evals UX Audit (W4)

**Date:** 2026-08-11 · **Branch:** `feat/agent-orchestrator-mvp`
**Scope:** the evaluation surface — `backend/agents/[id]/components/Evaluation*`, `backend/eval-cases/[id]/`, `backend/eval-runs/[id]/`, and the `api/eval-*` routes behind them.
**Commissioned by:** W4 of [`2026-08-10-pre-release-remediation-plan.md`](../specs/enterprise/agent-orchestrator/2026-08-10-pre-release-remediation-plan.md) — "Evals is unintuitive; the UX is the weakest surface in the module."

## Method, and its limits — read this first

This is a **structural audit**: source, route registry, generated module manifest, event declarations and git history. It is **not** the live empirical walkthrough the [July audit](./2026-07-12-agent-orchestrator-ux-audit.md) ran, which drove a populated environment with Playwright and 43 screenshots.

That distinction is load-bearing here. Earlier in this same workstream, the Traces surface was "audited" by grepping i18n keys and section names, concluded it was seven equal-weight cards in storage order, and proposed three redesigns for a page that already had most of them. The maintainer corrected it with screenshots. So every finding below is labelled with what actually backs it:

- **[structural]** — provable from the registry, the manifest, or a declaration. Does not need a browser to be true.
- **[needs live]** — reads as a problem in source; a walkthrough could show it is not.

Nothing here is ranked on feel. Where the surface is good, that is said.

## Summary

The evaluation surface is **not badly built**. `EvaluationTab` uses `DataTable`, `LoadingMessage`, `EmptyState`, per-section forbidden states, optimistic locking, guarded mutations, and a summary strip that *omits* metrics with no data rather than faking zeros. The `eval-runs/[id]` page paginates with a real cursor and renders an expected-vs-actual diff per diverging path. That is careful work.

The problem is not the components. It is that **#4489 consolidated the eval lists into the agent workspace and the surface around them was not updated to match** — a link, a test, and the navigation model were all left pointing at a shape that no longer exists. What "unintuitive" describes is most likely this: there is no longer any way to *browse* evaluations, and the one remaining signpost leads nowhere.

## P0 — Broken

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| **P0-1** | **The trace inspector's "View eval set" button navigates to a route that does not exist.** After a run is added to evals, the button routes to `/backend/eval-cases?status=draft`. No such page is registered: the generated manifest carries only `eval-cases/[id]/page.meta` and `eval-runs/[id]/page.meta`. The list page existed and was deleted in `6f81cdf49` ("agent-centric workspace + evaluation consolidation", #4489); the link survived it. So the single discoverable path from a run to its eval case is a dead end. **[structural]** | `backend/traces/[id]/page.tsx:960`; `apps/mercato/.mercato/generated/modules.generated.ts:1341-1342`; `git show 6f81cdf49 --stat` | Route to the agent's evaluation tab instead — `/backend/agents/<agentDefinitionId>?tab=evaluation&section=cases` (the tab already accepts both params). |
| **P0-2** | **An integration test asserts the deleted page works.** `TC-AGENT-NAV-005` navigates to `/backend/eval-cases?status=draft` and expects the draft to be listed, with the comment "the eval-cases page must list the created draft on the draft tab". It cannot pass. Either it is not running in CI, or it is running red and being tolerated — both are worse than the dead link, because they mean the suite is not trusted. **[structural]** | `__integration__/TC-AGENT-NAV-005.spec.ts:145-149` | Repoint at the same destination as P0-1 in the same change. Then find out which of the two explanations is true — that answer matters more than the test. |

## P1 — Major

### 1. Evaluations have no front door · **[structural]**

No `page.meta.ts` on the eval surface declares a `pageGroupKey`, so nothing appears in the sidebar. Every other page in the module does (`overview`, `caseload`, `agents`, `processes`, `traces`, `playground`, `audit`, `agentic-tasks`). The only route in is Agents → pick an agent → Evaluation tab.

Consolidating per-agent detail into the agent workspace is a defensible IA decision, and this audit does not argue against it. But it removed the only surface that could answer a **cross-agent** question, and nothing replaced it:

> Which of my agents are failing their evals right now?

Today that requires opening every agent in turn. Note the module's own Overview already carries a "Trust" panel per agent — the natural home for an eval-health column, without resurrecting a list page.

*Evidence:* `backend/*/page.meta.ts` (all eight declare `pageGroupKey`); the eval metas do not.

### 2. Three lists are silently capped at 100, and the cap is displayed as a count · **[structural]**

`EvaluationTab` fetches assertions, cases and runs with `pageSize=100` and no pagination — `DataTable` receives `data={filteredCases}` / `data={runs}` with no page props, so the fetch is the ceiling. The capped array's `.length` is then rendered as:

- the tab badges — `count={cases.length}`, `count={runs.length}`, `count={assertions.length}`
- the summary strip — `SummaryMetric label="Cases" value={String(cases.length)}`

An agent with 300 approved cases reports **"Cases 100"** as a fact, with nothing indicating a sample. This is the same family the July audit ranked P1-A1 ("silent 100-row samples presented as aggregates"), reappearing on a surface built after it.

The module already knows how to do this correctly: `eval-runs/[id]/page.tsx` requests `pageSize=100`, keeps `nextCursor`, and renders a load-more — with a comment explaining that a suite can hold up to 500 case runs. The tab did not inherit it.

*Evidence:* `EvaluationTab.tsx:185,190,211,224` (fetches); `:496,516-522` (counts); `:630-631,673-674` (unpaginated tables); contrast `eval-runs/[id]/page.tsx:61,323,362-391,669,806`.

### 3. Every eval record has two independent implementations · **[structural]**

| Record | In-workspace | Standalone page |
|---|---|---|
| Eval case | `EvalCaseDrawer.tsx` — 488 lines | `eval-cases/[id]/page.tsx` — 446 lines |
| Eval run results | `EvalResultsDrawer.tsx` — 244 lines | `eval-runs/[id]/page.tsx` — 824 lines |

Both are reachable, and the app moves between them: a row click in the tab opens the **drawer**, while `eval-runs/[id]/page.tsx:234` links to the **full case page**, and `EvalResultsDrawer.tsx:146` links to the **full run page**. So an operator following one path gets a drawer and another gets a page, for the same record.

The 244-vs-824 gap is the concrete risk: the run drawer cannot hold what the run page does (the expected-vs-actual per-path diff, the cursor pagination, the golden-record fetch). Whichever surface a user lands on decides how much they can see, and nothing tells them another view exists.

*Recommendation:* pick one per record and make the other a redirect. The drawer suits cases (short, editable, contextual); the page suits run results (long, paginated, diff-heavy) — which is roughly what the line counts already admit.

### 4. A running suite is frozen in the UI until it finishes · **[structural, effect needs live]**

`agent_orchestrator.eval_suite_run.started` is declared **without** `clientBroadcast: true`; only `.completed` carries it. `EvaluationTab` subscribes to `completed` alone.

The start is handled well — the drawer flashes "Evaluation started." and `onStarted` reloads the list, so the `queued` row appears immediately. But from that moment until the suite completes, nothing updates: no per-case progress, no elapsed time, no transition from `queued` to `running`. On a 500-case suite that is a long stretch of a screen that looks stalled.

Adding `clientBroadcast: true` to the `started` event is one line and gives the transition; genuine per-case progress is the `progress` module's job (`ProgressJob` + the top bar), which the module already depends on elsewhere.

*Evidence:* `events.ts:32-33`; `EvaluationTab.tsx:288`; `RunEvaluationDrawer.tsx:123-125`; `evalRunTypes.ts:317`.

## P2 — Minor

1. **Assertions are fetched twice and merged client-side** — once scoped to the agent, once for the `*` wildcard (`EvaluationTab.tsx:185,190`). Two round-trips, two independent 100-caps, and a client-side merge whose result feeds the badge in finding 2. A single `appliesTo=<agent>,*` would be one request with one honest total.
2. **Nesting depth is four levels** — workspace tabs → evaluation sub-tabs → drawer → expandable result rows. Each level is individually reasonable; the stack is what "unintuitive" may be describing, and it is worth confirming with a live walkthrough before restructuring anything. **[needs live]**
3. **Assertions get no `pageSize` disclosure in the UI at all**, unlike cases and runs which at least render inside a `DataTable` that could carry one.

## What is genuinely good — do not churn it

- The summary strip **omits** `Latest eval pass` and `vs previous run` when there is no data instead of rendering `0` or `—`. That is the honesty pattern the July audit asked for, applied without being asked.
- Per-section `forbidden` handling with a lock icon and a real explanation, rather than an empty table.
- `eval-runs/[id]` renders expected-vs-actual per diverging path, keeping `null`, `""` and a missing key distinguishable — with a comment explaining why that matters. Skipped verdicts render muted, never red.
- Writes go through `useGuardedMutation`, `buildOptimisticLockHeader` and `surfaceRecordConflict`. Nothing here is bypassing the platform's contracts.

## Recommended order

1. **P0-1 and P0-2 together** — one destination change, one test repoint. Small, and it removes the most visible "this feature is broken" signal in the surface.
2. **Finding 2 (the 100-caps)** — the fix is to copy the cursor pattern the module already uses one directory over. Until then the counts are wrong, which undermines every number on the tab.
3. **Finding 1 (the front door)** — an eval-health column on Overview's Trust panel is cheaper than a new page and answers the actual cross-agent question.
4. **Finding 3 (duplicate implementations)** — needs a decision before it needs code; it is the item most likely to be resolved differently once someone drives the surface.
5. **Finding 4** — the one-line `clientBroadcast` now; real progress when W1's migration squash opens these files anyway.

Before acting on findings 3 and 4, **run the live pass**. The July audit's most valuable findings came from the walkthrough, not the code read, and this audit deliberately did not run one.

## Carried forward from the plan

W4 also carries a defect that is not a UX matter but lands in the same files: the `agent_orchestrator` migration snapshot does not record `agent_eval_case_runs`, `agent_eval_suite_runs`, `agent_eval_results.eval_case_run_id`, `agent_proposals.source` or `agent_runs.source`, so the next `yarn db:generate` emits non-idempotent DDL. The plan's remedy — squash the module's migrations to a single current-state migration, which W1 wants regardless — still stands.
