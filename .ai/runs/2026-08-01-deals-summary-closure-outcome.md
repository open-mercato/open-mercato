# Execution plan — deals-summary-closure-outcome

Engine: om-auto-fix-issue (bug route: om-verify-in-repo → om-root-cause → om-fix → om-open-pr → om-auto-review-pr)
Base branch: develop
Branch: fix/issue-4697-deals-summary-closure-outcome
Issue: #4697

## Goal

Make `GET /api/customers/deals/summary` classify every deal exactly once. A deal closed by writing
`closure_outcome` alone — which the CRUD API explicitly permits — must leave the open-pipeline
figures instead of being reported as active pipeline and as won inside the same response.

## Context

`customer_deals` carries two independent closure signals. `status` is a lenient text column fed by a
per-tenant dictionary, and `closure_outcome` is a nullable `won` / `lost` enum. The supported writers
do not agree on which one they set: the closure UI writes both, the AI stage tool writes `status`
only, and `dealUpdateSchema` accepts `closureOutcome` on its own — `commands/deals.ts:717` assigns
that column without ever deriving `status` from it.

The summary route already reads both columns in its won/lost queries
(`(status = 'win' OR closure_outcome = 'won')`), but its open-deal queries read `status` alone
through the `OPEN_STATUSES` allowlist. A deal closed through `closureOutcome` therefore satisfies
both predicates at once: it is summed into `pipelineValue`, counted in `activeDeals`, and
simultaneously counted in `wonThisQuarter`. The same deal also disagrees with the
`dashboards.analytics.pipelineSummary` widget, which since #4683 filters `closureOutcome IS NULL` in
its default _Open deals only_ scope — so the card and the chart report different numbers for the same
tenant and period.

## Scope

- `packages/core/src/modules/customers/api/deals/summary/route.ts` — consume the summary query helper.
- `packages/core/src/modules/customers/lib/dealsSummaryQueries.ts` — own the SQL queries outside the route.
- The query-helper unit test and the `TC-CRM-082` integration spec.

## Non-goals

- No change to the `status IN ('open','in_progress')` allowlist itself. Whether it should become a
  denylist (mirroring the widget and the reasoning in #4621/#4629) is a product decision raised for
  the maintainer in the PR description, not taken here.
- No refactor of the route onto `customers/lib/dealStatus.ts`. That library classifies a JS-side
  status string; these are raw SQL predicates, and pulling one into the other is a separate change.
- No change to the won/lost queries, the win-rate series, or the widget.

## Implementation plan

### Phase 1: Correct the predicate

- **Step 1.1** — Introduce one shared open-deal SQL fragment next to `openPlaceholders`:
  `status IN (?,?) AND closure_outcome IS NULL`, documenting why it must be `IS NULL` and not a `!=`
  comparison (the column is nullable, so `closure_outcome != 'won'` evaluates to NULL for every
  genuinely open deal and would empty the pipeline rather than trim it).
- **Step 1.2** — Apply it to the three allowlist sites: the pipeline/stage aggregation that also
  carries the owner rollup, the quarter-over-quarter inflow delta, and the need-attention stuck
  intersection.
- **Step 1.3** — Apply the same guard to the fourth open-deal query, the overdue lookup that forms
  the other half of `needAttention`, so the whole card uses one definition of "open".

### Phase 2: Lock the behavior down

- **Step 2.1** — Unit regression test in the route's existing mocked-SQL harness: assert every
  open-deal query requires `closure_outcome IS NULL`, keeps its status allowlist, and uses no
  NULL-swallowing inequality; assert the won query still reads either column. Verify the test fails
  against the pre-fix route and passes after.
- **Step 2.2** — Integration case in `TC-CRM-082`: seed an open deal, confirm it raises
  `activeDeals`, close it with `PUT { id, closureOutcome: 'won' }`, confirm the read-back still shows
  `status = 'open'`, then assert the deal has left `activeDeals` and `pipelineValue` and is counted
  once in `wonThisQuarter`.

### Phase 3: Ship

- **Step 3.1** — Run the full validation gate from `.ai/agentic.config.json`.
- **Step 3.2** — Open the PR against `develop`, put the allowlist question to the maintainer in the
  description, run the review pass, and report the label set the account cannot apply.

### Phase 4: Review fixes

- **Step 4.1** — Merge current `develop` to pick up the sales CI stabilization already landed there.
- **Step 4.2** — Move the summary SQL into a module `lib/` helper per `.ai/lessons.md` and test
  the helper directly.

## Risks

- **Wrong NULL semantics.** The obvious spelling `closure_outcome != 'won'` silently drops every open
  deal because the column is NULL for all of them. Mitigated by using `IS NULL`, by a unit assertion
  that rejects `!=` / `<>` on that column, and by keeping the rule in one named helper.
- **Over-trimming the pipeline.** A tenant whose deals carry a stale `closure_outcome` alongside an
  open status would see the pipeline shrink after this change. That is the intended correction — such
  a deal is already being counted as won — and the integration test pins the expected direction.
- **Scope creep into the allowlist question.** Changing `status IN (...)` to a denylist in the same
  PR would alter which deals the cards see for tenants with custom dictionaries. Deliberately left to
  the maintainer.

## Progress

PR: #4819

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct the predicate

- [x] 1.1 Introduce the shared open-deal SQL fragment with the NULL-semantics rationale
- [x] 1.2 Apply it to the pipeline/stage aggregation, inflow delta and stuck intersection
- [x] 1.3 Apply the same guard to the overdue half of need-attention

### Phase 2: Lock the behavior down

- [x] 2.1 Unit regression test over the open-deal query shapes (fails pre-fix, passes post-fix)
- [x] 2.2 Integration case for a deal closed through `closure_outcome` alone

### Phase 3: Ship

- [x] 3.1 Run the full validation gate — 82deeaf81 (green except three pre-existing/environmental
      `yarn test` clusters, each reproduced independently of this change; detailed in the PR body)
- [x] 3.2 Open the PR, raise the allowlist question, review and report labels — #4819

### Phase 4: Review fixes

- [x] 4.1 Merge current `develop` to pick up the sales CI stabilization already landed there
- [x] 4.2 Move the summary SQL into a tested module helper
