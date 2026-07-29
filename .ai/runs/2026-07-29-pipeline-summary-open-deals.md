# Pipeline Summary widget: exclude closed deals from pipeline value

Fixes #4621.

## Goal

Stop the `dashboards.analytics.pipelineSummary` widget from presenting won and lost deals as
pipeline value, so the chart answers the question its title implies — what is currently in play.

## Scope

- `packages/core/src/modules/dashboards/widgets/dashboard/pipeline-summary/config.ts` — settings
  shape, request builder, closed-status constant.
- `packages/core/src/modules/dashboards/widgets/dashboard/pipeline-summary/widget.client.tsx` —
  consume the request builder, render the new status setting.
- `packages/core/src/modules/dashboards/i18n/{en,pl,de,es}.json` — keys for the new setting.
- New unit tests for the settings hydration and the request builder.

### Non-goals

- No change to `WidgetDataService`, `buildAggregationQuery`, or the analytics registry.
- No change to any other analytics widget.
- No change to the deals module, its statuses, or its own KPI endpoints.
- No new `closure_outcome` field mapping in `customers/analytics.ts` (see Risks).

## Design decisions

**Deny closed statuses rather than allow open ones.** `customer_deals.status` is a lenient
`z.string().max(50)` column, so tenants can and do carry stage-specific values beyond the
`['open', 'in_progress']` allowlist that `api/deals/summary/route.ts` uses for its KPI cards.
Filtering by an allowlist would silently drop every custom status from the chart — a worse
regression than the bug being fixed. The widget therefore excludes the two statuses the closure
flow actually writes (`useDealClosure` sets `status: 'win'` with `closureOutcome: 'won'`, and
`status: 'loose'` with `closureOutcome: 'lost'`).

**Two `neq` filters rather than one `not_in`.** `buildAggregationQuery` renders `not_in` as
`column != ALL(?)` with a raw JS array binding, a path no test or caller exercises today.
`neq` renders `column != ?` and is already covered. Two `neq` filters are combined with `AND`,
which is exactly the required predicate, without putting a first user on an unverified binding.

**Keep the old behavior reachable.** The setting `statusScope` defaults to `open` (the fix) but
offers `all` (the previous behavior), so a tenant that deliberately wanted lifetime totals is not
locked out. This is the "expose a status setting" half of the issue's proposal, with the safe
default the issue asks for.

**Move request-body construction into `config.ts`.** It makes the behavior unit-testable without
jsdom, and keeps the diff in `widget.client.tsx` small — relevant because PR #4627 (currency
formatting, still a draft) will touch the same component.

## Implementation Plan

### Phase 1: Status-aware request

- 1.1 Extend `PipelineSummarySettings` with `statusScope` (`'open' | 'all'`, default `'open'`),
  validate it in `hydrateSettings`, and add the `CLOSED_DEAL_STATUSES` constant.
- 1.2 Add `buildPipelineDataRequest(settings)` to `config.ts` emitting the `neq` filters for
  `open` and no filters for `all`; consume it from `fetchPipelineData`.

### Phase 2: Setting UI and translations

- 2.1 Render a `Select` for the status scope in the widget's `settings` mode, following the
  `orders-by-status` pattern.
- 2.2 Add `dashboards.analytics.settings.dealStatusScope`, `.dealStatusScopeOpen` and
  `.dealStatusScopeAll` to `en`, `pl`, `de` and `es`.

### Phase 3: Tests

- 3.1 Unit-test `hydrateSettings`: default, valid override, invalid value falls back.
- 3.2 Unit-test `buildPipelineDataRequest`: `open` emits both `neq` filters and preserves
  metric/groupBy/dateRange; `all` emits no `filters` key.

### Phase 4: Validation

- 4.1 Run the full `validation.commands` gate.

## Risks

- **Behavior change on an existing widget.** Dashboards that showed lifetime deal value will drop
  to open-pipeline value after upgrade. That is the point of the fix, but it is a visible change;
  the `all` scope is the documented escape hatch and the PR body calls it out.
- **`closure_outcome` written without a status change.** The deal-closure UI always writes both,
  but the CRUD API allows setting `closureOutcome` alone. Such a record would still count as
  pipeline. Filtering it out would require adding `closureOutcome` to the analytics field mappings
  in the customers module; that is deliberately out of scope here and noted on the issue.
- **Overlap with PR #4627.** That draft will also edit `pipeline-summary/widget.client.tsx` (money
  formatting). The changes touch different lines; whichever lands second rebases.

## Validation blocker (pre-existing, not caused by this change)

`yarn i18n:check-usage` exits 1 on this branch **and on a clean `upstream/develop`**, reporting two
missing keys referenced from `packages/ui/src/backend/fields/phone.tsx:58,69`:
`ui.customFields.phone.defaultCountry` and `ui.customFields.phone.defaultCountryAuto`. This branch
touches neither `packages/ui` nor `apps/mercato/src/i18n` — the diff is confined to `.ai/runs/` and
`packages/core/src/modules/dashboards/`. PR #4608 (`fix(i18n): define the phone custom-field
translation keys`, still open) is the fix for it; duplicating that work here would collide with it
on the same locale files. Every other gate command passes, including `i18n:check-sync`, which is the
one that covers the keys this change adds.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Status-aware request

- [x] 1.1 Extend settings with `statusScope` and add `CLOSED_DEAL_STATUSES` — c0b325ac1
- [x] 1.2 Add `buildPipelineDataRequest` and consume it in the widget — c0b325ac1

### Phase 2: Setting UI and translations

- [x] 2.1 Render the status-scope `Select` in settings mode — c0b325ac1
- [x] 2.2 Add the translation keys to en, pl, de and es — c0b325ac1

### Phase 3: Tests

- [x] 3.1 Unit-test `hydrateSettings` — c0b325ac1
- [x] 3.2 Unit-test `buildPipelineDataRequest` — c0b325ac1

### Phase 4: Validation

- [x] 4.1 Run the full validation gate — 7/8 green; `i18n:check-usage` blocked by a pre-existing failure (see Validation blocker)
