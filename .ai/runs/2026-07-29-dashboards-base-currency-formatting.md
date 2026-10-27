# Dashboard analytics widgets hardcode USD currency formatting (#4620)

Issue: https://github.com/open-mercato/open-mercato/issues/4620

## Problem

`packages/core/src/modules/dashboards/lib/formatters.ts` defaults every money formatter to
USD (`currency = 'USD'`, `currencySymbol = '$'`) and all analytics widgets pass the formatter
by reference, so a tenant whose base currency is PLN sees correct numbers labelled `USD`/`$`.

## Approach

Resolve the tenant/organization base currency server-side (the `currencies` module already
stores `is_base`) and ship it with the widget-data response, so every analytics widget formats
in the tenant's own currency without a second round-trip and without a per-widget setting.

1. `currencies/services/baseCurrencyService.ts` — own the scoped lookup beside the table,
   represent missing/ambiguous/unavailable results explicitly, and expose it through the
   optional `baseCurrencyService` DI registration. Dashboard and customer consumers resolve
   it fail-soft; `WidgetDataService` memoizes only the injected resolver result.
2. `api/widgets/data/schema.ts` — extend the response schema with the optional
   `metadata.currency` field (additive, OpenAPI-visible).
3. `lib/formatters.ts` — drop the USD/`$` defaults. Without a currency the helpers format a
   plain number (never a wrong label); with one they use cached, locale-aware
   `Intl.NumberFormat` instances. `createCurrencyFormatters(currency, fallback, locale)` binds
   the active locale while the legacy literal-symbol compact call stays compatible.
4. Widgets (`revenue-kpi`, `aov-kpi`, `pipeline-summary`, `revenue-trend`, `top-customers`,
   `top-products`, `sales-by-region`) — read `metadata.currency` from the response and format
   through the memoized formatters.
5. `subscribers/invalidateWidgetDataCache.ts` — invalidate tenant-scoped widget data after
   every currency mutation so a changed base label is visible on the next request.
6. Tests — resolver, disabled-module, cache invalidation, locale formatting, service, and
   rendered KPI/table propagation coverage.

## Progress

- [x] Triage (`om-verify-in-repo`): real, unfixed, no PR in flight
- [x] `lib/formatters.ts` rewritten (no USD default + formatter factory)
- [x] Currencies-owned service resolves the base currency and dashboards inject it optionally
- [x] Customer deal analytics use the same currencies-owned lookup (#4678)
- [x] Currency changes invalidate cached widget responses
- [x] Every money widget binds the active application locale
- [x] `api/widgets/data/schema.ts` extended
- [x] 7 widgets format via the resolved currency
- [x] Unit/component tests (resolver, formatters, service, cache, rendered widgets)
- [x] Validation gate
- [x] PR consolidated — https://github.com/open-mercato/open-mercato/pull/4656
- [x] Parallel implementation #4649 superseded by #4656

## Follow-up: record-level currency uniformity (#4676)

The base-currency resolution above guards **organization** ambiguity but not **record**
ambiguity. `sales_orders.currency_code` is a per-row column and the money widgets sum
`grand_total_gross_amount` with no currency filter, so a PLN-based organization holding
900 PLN and 100 EUR of orders rendered `1 000 zł` — a credible label on a total that mixes
two currencies. That limitation was filed as #4676 and is now closed by this follow-up.

The symmetric guard chosen is the cheap one the issue describes, not the exchange-rate
conversion route: the base currency survives only when the rows actually aggregated all
carry exactly that code.

1. `packages/shared/src/modules/analytics.ts` — `AnalyticsEntityTypeConfig` gains the
   optional `currencyField`, so an entity can declare which of its mapped fields holds the
   per-row currency. Additive and optional, so existing analytics configs are unaffected.
2. `packages/core/src/modules/sales/analytics.ts` — `sales:orders` and `sales:quotes`
   declare `currencyField: 'currencyCode'`.
3. `lib/aggregations.ts` — the scope/date-range/filter WHERE building is extracted into a
   shared helper, and `buildDistinctCurrencyQuery()` reuses it to read the distinct row
   currencies over exactly the rows the aggregation sums (`LIMIT 2` — telling "one" from
   "several" needs no more).
4. `services/widgetDataService.ts` — `resolveCurrencyLabel()` keeps the resolved base
   currency only when every aggregated range passes `rowsShareCurrency()`. The comparison
   range is checked too, so a mixed previous period does not get a labelled delta. The check
   is skipped entirely when no base currency resolved, so the unbounded-scope path costs
   nothing extra. Anything unprovable — mixed codes, a NULL code, a lookup failure, a single
   code that disagrees with the base — resolves to `null`.
5. `components/UnlabelledAmountNotice.tsx` — a shared muted hint the seven money widgets
   render when `metadata.currency` is `null`, so a bare number reads as a deliberate
   omission rather than a broken widget. Copy lives in the four dashboards locale files.
6. Tests — `services/__tests__/widgetDataService.test.ts` covers the record-level cases
   alongside the existing organization-level ones, and `lib/__tests__/aggregations.test.ts`
   covers the query builder.

### Remaining limitation

Amounts are still never converted. A genuinely multi-currency period shows an unlabelled
total rather than a base-currency-converted one. Converting through `exchangeRateService`
the way `customers/api/deals/summary/route.ts` does — reporting `convertedAll` and
`missingRateCurrencies` — remains the complete answer and is deliberately out of scope here.
