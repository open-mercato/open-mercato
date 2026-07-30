# Close the closure-outcome gap in the pipeline summary (#4668)

## Goal

Make the `pipelineSummary` widget agree with the deals-summary KPI cards about which deals are
still open. The KPI counts a deal as won or lost when **either** `status` **or**
`closure_outcome` says so (`api/deals/summary/route.ts:244,258-261,277-278`); the chart could
only test `status`, because the analytics/aggregation layer had no mapping for the second
column. Both halves ship here: the mapping, and the request that consumes it.

## Scope

- `packages/core/src/modules/customers/analytics.ts` — map `closureOutcome` to the existing
  `closure_outcome` column, so the aggregation layer can express the predicate at all.
- `packages/core/src/modules/dashboards/widgets/dashboard/pipeline-summary/config.ts` — the
  `open` scope now also sends `closureOutcome IS NULL`, so a deal closed through
  `closure_outcome` alone leaves the chart.
- `packages/core/src/modules/customers/__tests__/analytics.test.ts` — mapping coverage plus a
  guard that every deals field maps to the snake_case column of the same name.
- `pipeline-summary/__tests__/config.test.ts` — the extended request shape.
- `pipeline-summary/__tests__/request-sql.test.ts` — new: runs the widget's request through
  `buildAggregationQuery` with the real customers analytics config and asserts the SQL.

## Notes

### Why the closure-outcome side is `IS NULL`, not a `neq` denylist

`closure_outcome` is nullable and every open deal holds NULL there. `neq` renders as
`column != ?` (`dashboards/lib/aggregations.ts:180-183`), and in SQL `NULL != 'won'` evaluates
to NULL rather than true — a `neq` denylist would drop **every open deal** and empty the chart.
`not_in` (`!= ALL(?)`) fails identically. `status` has no such problem: it is `text not null
default 'open'`, which is why #4629's status side is a denylist and stays one.

The second reason is vocabulary. `status` is fed by the per-tenant `deal_status` dictionary, so
an unknown value must keep counting as open — hence a denylist there. `closure_outcome` is not:
every write path validates it against the same closed `z.enum(['won', 'lost'])`
(`customers/data/validators.ts:178`, `api/deals/[id]/route.ts:916`,
`api/deals/[id]/stats/route.ts:182`), so a non-null value always means closed and there is no
tenant-specific vocabulary to preserve.

### Why the SQL-level test exists

`buildAggregationQuery` skips a filter whose field has no mapping (`if (!filterMapping)
continue`, `aggregations.ts:172-173`) — silently. Deleting the `closureOutcome` mapping would
therefore not fail a test that only inspects the request object; the chart would just quietly
stop excluding those deals. `request-sql.test.ts` asserts the emitted SQL instead, which closes
that hole.

### Relationship to the other PRs

This branch is **stacked on #4629** and must not merge before it: `buildPipelineDataRequest`,
the function these filters extend, is introduced there. #4667 remains separate — it tracks the
company-KPI surfaces that test `status` against a `won`/`lost` vocabulary no writer persists,
which is a different bug on different files.

## Progress

- [x] Verify the gap on `develop` and confirm the column exists on the entity
- [x] Add the field mapping
- [x] Add mapping coverage; confirm it fails without the mapping
- [x] Confirm #4668 is not already covered by #4629 (analytics.ts untouched there; `develop`
      still maps seven deals fields; every "closure" hit in that diff is prose)
- [x] Merge the latest `develop`, then stack on #4629's head
- [x] Send the `closureOutcome` predicate from the widget's open scope
- [x] Cover the extended request shape and the emitted SQL
- [x] Prove all three regressions are caught: dropped mapping (2 failures), status-only filter
      list (4 failures), `neq` instead of `is_null` (6 failures)
- [ ] Run the full validation gate
- [ ] Re-request review and UI QA
