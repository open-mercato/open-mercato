# Dashboard analytics widgets: format money in the tenant base currency

Issue: [#4620](https://github.com/open-mercato/open-mercato/issues/4620)

## Goal

Stop dashboard analytics widgets from labelling every amount as USD. Money rendered by the
analytics widgets must carry the tenant/organization base currency (`currencies.is_base`),
falling back to today's `USD` only when no base currency can be resolved.

## Scope

- `packages/core/src/modules/dashboards/lib/formatters.ts` — currency-aware formatting helpers.
- `packages/core/src/modules/dashboards/lib/baseCurrency.ts` (new) — scope-aware base-currency lookup.
- `packages/core/src/modules/dashboards/services/widgetDataService.ts` — expose the resolved
  currency on `WidgetDataResponse.metadata` so widgets do not need a second request.
- The six money-rendering analytics widgets: `revenue-kpi`, `aov-kpi`, `pipeline-summary`,
  `revenue-trend`, `sales-by-region`, `top-customers`, plus `top-products` (same defect, not
  listed in the issue).
- Unit tests for the formatters, the lookup helper, and the service metadata.

### Non-goals

- No per-widget currency-override setting (the tenant base currency covers the reported case;
  an override would touch seven `config.ts` files and their settings UI).
- No FX conversion of multi-currency data — widgets aggregate raw amounts today and this change
  does not alter the numbers, only their label.
- No changes to `packages/ui/src/utils/format.ts` (a separate, already currency-aware helper).

## Implementation Plan

### Phase 1: Currency-aware formatting primitives

Extend `formatters.ts` so compact formatting is locale-correct for non-USD currencies (a `zł`
suffix cannot be prefixed like `$`), keeping the legacy `formatCurrencyCompact(value, '€')`
symbol form working for third-party callers.

### Phase 2: Resolve the base currency server-side

Add a scope-aware lookup against `currencies.is_base` (raw SQL, same approach as
`customers/api/deals/aggregate`), tolerant of the `currencies` module being absent, and surface
the result on `WidgetDataResponse.metadata.currency`.

### Phase 3: Wire the widgets

Each widget stores the currency from the response metadata and passes it into the formatter.

### Phase 4: Validation

Full `validation.commands` gate, then the authoritative review pass.

## Risks

- The widget-data cache stores the whole response, so a base-currency change propagates after
  the 120s TTL. Acceptable — the cache key is already scope-derived.
- `formatCurrencyCompact` output changes shape for negatives (`-$1.5K` instead of `$-1.5K`) once
  the Intl path is used; that is a correctness improvement, covered by updated tests.

## Progress

PR: #4627

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Currency-aware formatting primitives

- [x] 1.1 Make `formatCurrency*` helpers accept and honor a currency code — a2efb7860
- [x] 1.2 Update and extend the formatter unit tests — a2efb7860

### Phase 2: Resolve the base currency server-side

- [x] 2.1 Add the scope-aware base-currency lookup helper with tests — c5dec6d36
- [x] 2.2 Expose the resolved currency on `WidgetDataResponse.metadata` — c5dec6d36

### Phase 3: Wire the widgets

- [x] 3.1 Pass the resolved currency through all seven money-rendering widgets — c8b1bc5d8

### Phase 4: Validation

- [x] 4.1 Run the full validation gate — 53239a7c6
- [x] 4.2 Address the authoritative review pass — 53239a7c6
