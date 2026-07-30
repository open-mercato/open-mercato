# Expose closureOutcome to the customers analytics field mappings (#4668)

## Goal

Let the analytics/aggregation layer filter `customers:deals` on `closure_outcome`, so a
closed-deal predicate can match the KPI definition instead of relying on `status` alone.

## Scope

- `packages/core/src/modules/customers/analytics.ts` — map `closureOutcome` to the existing
  `closure_outcome` column.
- `packages/core/src/modules/customers/__tests__/analytics.test.ts` — new coverage for the
  mapping plus a guard that every deals field maps to the snake_case column of the same name.

## Notes

The column already exists on the entity (`data/entities.ts:355`, `closure_outcome`, nullable
text) and is part of the deal's update-scoped property set, so this is purely an
analytics-layer exposure — no migration and no write-path change.

The follow-up work #4629 deferred (rewriting the `pipelineSummary` denylist to consult
`closureOutcome`) is deliberately **not** in this PR: #4667 tracks the wider status-vocabulary
mismatch across the read-side surfaces, and picking a predicate here would pre-empt that
decision. This PR only makes the field expressible.

## Progress

- [x] Verify the gap on `develop` and confirm the column exists on the entity
- [x] Add the field mapping
- [x] Add regression coverage; confirm it fails without the mapping
- [x] Run the full validation gate
- [x] Open the PR and request labels from a maintainer
