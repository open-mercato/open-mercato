# Analytics amounts labelled with the base currency across mixed-currency rows (#4676)

Issue: https://github.com/open-mercato/open-mercato/issues/4676
Stacked on: https://github.com/open-mercato/open-mercato/pull/4656 (`carry/pr-4631-ready`)

## Problem

#4656 stopped the dashboards analytics widgets from labelling amounts with a hard-coded
`USD`/`$`: they now format with the base currency `WidgetDataService` resolves for the
request scope. That resolution guards **organization** ambiguity — several organizations
with different base currencies resolve to `null` — but applies no equivalent check to the
rows the aggregation actually sums.

`sales_orders.currency_code` is a non-nullable per-row column, yet the money widgets
(`revenue-kpi`, `aov-kpi`, `revenue-trend`, `sales-by-region`, `top-products`,
`top-customers`, `pipeline-summary`) sum `grand_total_gross_amount` with no currency filter
and no grouping by currency. A PLN-based organization holding 900 PLN and 100 EUR of orders
renders `1 000 zł`: a sum of two currencies presented with a specific, credible label.

Before #4656 the same figure read `$1,000` — equally wrong, but obviously a default. The
mis-summing predates #4656; what that PR changes is how believable the label is, which is
exactly the failure mode #4620 describes.

## Approach

The symmetric guard the issue calls "the cheap version", not the exchange-rate conversion
route. One rule, easy to state and to test: **the resolved base currency survives only when
every row the aggregation sums carries exactly that code.**

Conversion through `exchangeRateService` (as `customers/api/deals/summary/route.ts` does,
reporting `convertedAll` and `missingRateCurrencies`) remains the complete answer and is
deliberately left out of scope — it is a feature, not a correctness fix.

1. `packages/shared/src/modules/analytics.ts` — `AnalyticsEntityTypeConfig` gains an
   optional `currencyField`, letting an entity declare which mapped field holds its per-row
   currency. Additive and optional: existing analytics configs are untouched and keep
   working, so no contract surface breaks.
2. **Every entity the money widgets aggregate declares its currency column** —
   `sales:orders` and `sales:quotes` (`currencyCode` → `currency_code`),
   `sales:order_lines` (`currencyCode` → `currency_code`, newly mapped; `top-products`
   aggregates it) and `customers:deals` (`valueCurrency` → `value_currency`, newly mapped;
   `pipeline-summary` aggregates it). Covering only `sales:orders` would have left two of the
   seven widgets the issue names unguarded — caught in review.
3. `packages/core/src/modules/dashboards/lib/aggregations.ts` — the scope / date-range /
   filter WHERE building is extracted into a shared helper so the new
   `buildDistinctCurrencyQuery()` reads distinct row currencies over *exactly* the rows the
   aggregation sums. It normalizes whitespace/case before `SELECT DISTINCT` and reads at
   most two results — enough to distinguish one code from several without variants masking
   a conflict.
4. `packages/core/src/modules/dashboards/services/widgetDataService.ts` —
   `resolveCurrencyLabel()` keeps the base currency only when every aggregated range passes
   `rowsShareCurrency()`. The comparison range is checked too, so a mixed previous period
   cannot produce a labelled delta. The check is skipped when no base currency resolved, so
   the unbounded-scope path costs nothing. Mixed codes, a lookup failure, or a single code
   disagreeing with the base all resolve to `null`.

   Rows with **no recorded currency** fail closed because a nullable
   `customer_deals.value_currency` does not prove that the amount uses the tenant base
   currency. An empty range still passes because there is no row to mislabel.
5. `packages/core/src/modules/dashboards/components/UnlabelledAmountNotice.tsx` — a shared
   muted hint the seven money widgets render when `metadata.currency` is `null`, so a bare
   number reads as a deliberate omission rather than a broken widget. Cause-neutral copy
   covers mixed rows, unresolved scope/configuration, and lookup failures in all four
   dashboards locale files.
6. Tests — record-level cases in `services/__tests__/widgetDataService.test.ts` alongside the
   existing organization-level ones, plus query-builder cases in
   `lib/__tests__/aggregations.test.ts`.

## Progress

- [x] Triage: real, still-unfixed follow-up; every acceptance criterion depends on #4656, which is unmerged — hence the stacked branch
- [x] `AnalyticsEntityTypeConfig.currencyField` declared (additive)
- [x] `sales:orders`, `sales:quotes`, `sales:order_lines` and `customers:deals` declare their currency column
- [x] `buildDistinctCurrencyQuery()` + extracted WHERE-clause helper
- [x] `resolveCurrencyLabel()` / `rowsShareCurrency()` in `WidgetDataService`
- [x] `UnlabelledAmountNotice` wired into all seven money widgets
- [x] i18n copy in `en` / `pl` / `de` / `es`
- [x] Unit tests (service + query builder)
- [x] Component tests for the shared unlabelled-amount notice
- [x] `.ai/runs/2026-07-29-dashboards-base-currency-formatting.md` records the closed limitation
- [x] Validation gate
- [x] Self code review (`om-auto-review-pr --autofix`) — one major (two of the seven widgets uncovered) and one minor (silent catch) found and fixed
- [x] Maintainer review autofix — missing row currencies now fail closed, SQL codes are
  normalized before limiting, notice copy is cause-neutral, and the inline icon uses Lucide
- [ ] Manual QA of the seven widgets (`needs-qa`)

## Validation

Runner: local (`yarn`, no compose `app` container running). The ordered
`validation.commands` from `.ai/agentic.config.json`:

| Command | Result |
|---------|--------|
| `yarn build:packages` | ✅ 21/21 |
| `yarn generate` | ✅ 87 artifacts refreshed |
| `yarn build:packages` | ✅ 21/21 |
| `yarn i18n:check-sync` | ✅ all four locales in sync |
| `yarn i18n:check-usage` | ✅ missing phone-field keys repaired in the entities locale |
| `yarn typecheck` | ✅ 21/21 |
| `yarn test` | ✅ 23/23 tasks |
| `yarn build:app` | ✅ |
| `yarn lint` (extra) | ✅ 0 errors (12 pre-existing warnings) |

`packages/shared` exits non-zero on a first run with "a worker process has failed to exit
gracefully" while reporting 140/140 suites and 1513/1513 tests passed — a known teardown
leak in this repo, not a failure caused by this change.
