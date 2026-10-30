# Deal Status Vocabulary — Rename `loose` to `lost`

**Date:** 2026-08-24
**Status:** Accepted
**Module:** `packages/core/src/modules/customers`
**Related:** #4667 (deal status single source of truth), #5107 (canonical status filters)

## Context

`customer_deals.status` carried `loose` as the canonical lost-deal spelling. It is a
misspelling of `lost`, and it was the only surface still using it: `closure_outcome` stores
`lost`, the AI tool `customers.update_deal_stage` writes `lost`, and every operator-facing
label reads "Lost".

#4667 made `lib/dealStatus.ts` the single source of truth for terminal-status semantics and
accepted both spellings so no writer produced an unreadable status. That reconciled readers
but left `loose` canonical, so `canonicalDealStatus('lost')` returned `'loose'` and the
seeded dictionaries shipped `{ value: 'loose', label: 'Loose' }`.

Two operator-visible consequences followed. The kanban board named one stored status twice:
`QuickDealDialog` resolved `customers.deals.kanban.quickDeal.status.loose`, translated as
"stalled" in all five locales, while `StatusFilterPopover` mapped the same value to "Lost".
`PIPELINE_STAGE_DEFAULTS` also carries a separate `stalled` stage, so the quick-deal wording
collided with a stage that already exists.

## Decision

`lost` becomes the canonical spelling. `loose` stays an accepted alias on every read path and
is exported as a deprecated constant, so no downstream module breaks and no stored row is
orphaned.

- `DEAL_STATUS_LOST = 'lost'` is the constant writers use. `DEAL_STATUS_LOSE` remains,
  marked `@deprecated`, scheduled for removal no earlier than 0.9.0.
- `LOST_DEAL_STATUS_LIST` keeps both spellings, canonical first.
- `canonicalDealStatus` normalizes `loose` to `lost`, reversing the previous direction.
- Writers persist `lost`: `useDealClosure`, the kanban `updateDealStatus`, the `cli.ts` seeds
  and the seeded example data.
- The i18n key follows the value, so `quickDeal.status.loose` becomes `quickDeal.status.lost`
  and each locale now names it after its own `filter.status.lost` wording.
- Raw SQL in `lib/dealsSummaryQueries.ts` matches `status IN ('lost', 'loose')`, so win/loss
  counters stay correct on an instance that has not run the migration.

### Alternatives considered

**Leave `loose` canonical and fix only the labels.** Cheapest, and it removes the
operator-visible contradiction, but it keeps a misspelling in the API surface, in raw SQL and
in every tenant dictionary, and it leaves two spellings for readers to reconcile forever.

**Hard rename with no alias.** Smaller diff and one spelling afterwards, but it breaks every
downstream module importing `DEAL_STATUS_LOSE`, and any row missed by the migration silently
reclassifies as open. Rejected against `BACKWARD_COMPATIBILITY.md`.

## Migration & Backward Compatibility

No contract surface is removed or narrowed. `data/validators.ts` is untouched: the deal
`status` field is a free-form `z.string()` and `closureOutcome` keeps its `['won', 'lost']`
enum. The aggregate route's `status` filter has accepted arbitrary strings since #5107.

`Migration20260824180000_deal_status_lost` is forward-only and deletes nothing:

| Target | Action |
|--------|--------|
| `customer_deals.status`, `customer_deals.pipeline_stage` | `loose` becomes `lost` |
| `customer_dictionary_entries` (`deal_status`, `pipeline_stage`) | the `loose` entry is renamed only when the scope has no `lost` entry, because `customer_dictionary_entries_unique` covers (org, tenant, kind, normalized_value); its label is corrected only when it is still the seeded `Loose` |
| `customer_pipeline_stages.name` | the seeded `Loose` label becomes `Lost` |

Deploy order is safe forward and unsafe backward: new code on un-migrated data classifies correctly, migrated data under rolled-back 0.7.0 code does not. See Risks & Impact Review below.

A tenant that renamed the option keeps its own wording, and a tenant that already holds both
entries keeps both. Those rows still classify correctly, because readers accept `loose`
through `LOST_DEAL_STATUS_LIST`, `expandDealStatusAliases` and
`TERMINAL_PIPELINE_STAGE_LABELS`.

`down()` is a documented no-op. An instance may have held `lost` rows before the migration
ran, and afterwards those are indistinguishable from the ones it renamed, so reverting would
have to guess. Leaving the data on the canonical spelling is safe because both are readable.

**Downstream action:** replace `DEAL_STATUS_LOSE` with `DEAL_STATUS_LOST`. Code that compares
a status literally against `'loose'` should call `isLostDealStatus` instead, which matches
both spellings. Code that reads `canonicalDealStatus` output and expects `'loose'` must
expect `'lost'`.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| The code is rolled back to 0.7.0 after the migration ran. 0.7.0's `dealsSummaryQueries.ts` matches `status = 'loose'` against rows that now say `lost`. | Medium | Quarter win/loss KPI and the monthly trend series | Documented in `UPGRADE_NOTES.md` with the manual reversal statement; `down()` is deliberately a no-op rather than a lossy guess | Silent. The query returns `0`, not an error, so an operator sees a blank number rather than a failure |
| The win/loss SQL is later narrowed back to one spelling. | Medium | Same KPI surfaces | `dealsSummaryQueries.test.ts` pins `status IN ('lost', 'loose')` on the same mocked call that already pins the won half | None once the assertion is in place |
| A tenant holds both a `loose` and a `lost` dictionary entry, so the rename would violate `customer_dictionary_entries_unique`. | Low | Deal status and pipeline stage dictionaries | The migration's correlated `NOT EXISTS` skips that scope entirely | The tenant keeps two entries. Both classify correctly through the read aliases, and an operator may see a duplicate option until they tidy it |
| A tenant renamed the option and the migration overwrites their wording. | Low | Dictionary labels | The label rewrite is conditional on the value still being the seeded `Loose` | None |
| The migration stamps `updated_at` on `customer_deals`. | High if it happened | Win/loss KPI windowing and the trend series | It does not, and the migration test asserts the absence | None |
| `loose` is removed from `LOST_DEAL_STATUS_LIST` at 0.9.0 while the dashboards module keeps its own hard-coded copy. | Medium | Pipeline-summary widget | `dashboards/.../config.test.ts` cross-checks its literal against `CLOSED_DEAL_STATUS_LIST` | None once that assertion is in place |

## Changelog

- **2026-08-24** — Initial specification.
