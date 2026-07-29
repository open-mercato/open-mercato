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

1. `services/widgetDataService.ts` — resolve the base currency code once per request
   (memoized), scoped by tenant + the request's organization ids; expose it as
   `metadata.currency`. Ambiguous scope (several organizations with different base
   currencies) or a missing/unavailable `currencies` table resolves to `null`.
2. `api/widgets/data/schema.ts` — extend the response schema with the optional
   `metadata.currency` field (additive, OpenAPI-visible).
3. `lib/formatters.ts` — drop the USD/`$` defaults. Without a currency the helpers format a
   plain number (never a wrong label); with one they use `Intl.NumberFormat`. Add
   `createCurrencyFormatters(currency)` so widgets pass a stable single-argument formatter.
4. Widgets (`revenue-kpi`, `aov-kpi`, `pipeline-summary`, `revenue-trend`, `top-customers`,
   `top-products`, `sales-by-region`) — read `metadata.currency` from the response and format
   through the memoized formatters.
5. Tests — formatter unit tests (no currency, explicit currency, compact, legacy symbol
   argument) and widget-data service tests for base-currency resolution.

## Progress

- [x] Triage (`om-verify-in-repo`): real, unfixed, no PR in flight
- [x] `lib/formatters.ts` rewritten (no USD default + formatter factory)
- [x] `services/widgetDataService.ts` resolves and returns `metadata.currency`
- [x] `api/widgets/data/schema.ts` extended
- [x] 7 widgets format via the resolved currency
- [x] Unit tests (formatters + service)
- [x] Validation gate
- [x] PR opened — https://github.com/open-mercato/open-mercato/pull/4631
