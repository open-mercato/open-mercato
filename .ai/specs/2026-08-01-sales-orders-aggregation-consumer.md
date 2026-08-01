# Sales Orders Filtered Aggregation Consumer

> **Status**: Draft — ready for implementation
> **Scope**: OSS (`packages/ui`, `packages/core` sales)
> **Created**: 2026-08-01
> **Prerequisites**: [`2026-08-01-datatable-native-column-footers.md`](./2026-08-01-datatable-native-column-footers.md), [`2026-07-24-datatable-column-aggregations.md`](./2026-07-24-datatable-column-aggregations.md)
> **Follow-up**: [`2026-08-01-datatable-aggregation-controls.md`](./2026-08-01-datatable-aggregation-controls.md)

## TLDR

Adopt the generic CRUD aggregation service on `/backend/sales/orders`: add an allow-listed summary declaration and evidence-driven indexes, reuse one filter serializer for list and summary requests, and render exact currency-separated net/gross totals plus record count in native column footers. A temporary translated “Show totals” toggle proves the end-to-end capability without persisting preferences. `DataTable` owns only generic request cancellation/generation/footer state; the Sales host owns route serialization and loading.

## Overview

This specification is the first business consumer of the generic aggregation service and native footer primitive. It opts in Orders only, maps every public/physical/row/column namespace explicitly, keeps list and summary filters identical, binds result lifecycle to resource/filter/organization scope, and renders exact currency totals plus a plural-aware order count. Persisted per-column choices remain a linked follow-up.

## Resolved assumptions

| Question | Decision | Rationale |
|---|---|---|
| Initial affordance | One ephemeral list-level “Show totals” toggle | Proves the consumer without bundling the follow-up per-column persistence capability |
| Selected functions | Fixed `sum` for net/gross and base-record `count` on the visible `number` column while enabled | Keeps this consumer deterministic; function choice belongs to the controls follow-up, and Orders has no visible `id` column |
| Money grouping | Group each money field by currency | Cross-currency sums are invalid without an FX policy |
| Precision | Format canonical decimal strings without `Number(value)` | Preserves exact API results beyond IEEE-754 range |
| Selection identity | One map keyed only by stable TanStack column id | Avoids duplicated selection ownership and keeps public request-field mapping in column metadata |
| Footer activation | Each aggregate column defines an explicit `ColumnDef.footer` renderer | Satisfies the native footer primitive's opt-in contract |
| Controls adoption | The follow-up replaces the temporary toggle for Orders; it does not coexist | Prevents conflicting request precedence and enabled-state rules |
| Line-item totals, role defaults, FX | Deferred | Each is independent policy/capability work |

## Problem Statement

Sales operators filter Orders by channel, customer, date, tags, search, or amount and need totals over the entire matching result set. Summing the current page is wrong. A second filter implementation is also unsafe because it can drift from the visible list's scope and query semantics.

The generic backend service solves the server contract but intentionally has no UI ownership. This consumer must map the Sales API, physical schema, row accessors, column ids, and display currency explicitly; bind one request lifecycle to the current filters; and preserve exact money values through rendering.

## Goals

- Opt `/api/sales/orders` into route-declared `sum` for net/gross and `count` for id.
- Reuse the exact normalized list filters for the separate summary request, excluding page and sort.
- Render currency-separated totals under net/gross and a translated base-record count under the existing order-number column.
- Make no summary request while totals are disabled.
- Cancel/discard stale responses when filters or selections change.
- Add bounded database indexes and `EXPLAIN`/latency evidence for common Sales filters.
- Provide self-contained, mixed-currency, cross-organization, duplicate-join integration coverage.

## Non-goals

- User-persisted or per-column function choices; that is the linked controls spec.
- FX conversion, line-item totals, quote summaries, custom-field aggregate selectors, cache, or role defaults.
- Changes to the generic backend aggregate service or native footer semantics.

## Proposed Solution

Declare three safe Orders summary fields, add only evidence-backed scope/date/channel indexes, extract one normalized list/summary filter serializer, and pass a route-neutral loader/controller into `DataTable`. A temporary toggle selects net sum, gross sum, and distinct order count; explicit column footers render validated exact results. The controls follow-up later replaces that toggle through a mutually exclusive mode.

## Architecture

The existing Sales list host owns `scopeVersion`, normalized filters, resource identity, summary key, and `apiCall` loader. The shared `DataTable` owns cancellation/generation, strict response-to-column mapping, and footer state. The generic CRUD route/Query Engine owns authorization, tenant/organization/deleted scope, query execution, and response normalization. The native footer primitive owns semantic alignment only. No module crosses ownership through ORM relationships or direct service imports.

## Data Models

No business value column changes. Two additive partial indexes are proposed on `SalesOrder`, with a generated migration and sales snapshot update. The UI uses exported additive summary/controller types with canonical string values. No total is persisted, and column selections in this phase are ephemeral.

## API Contracts

`GET /api/sales/orders` opts into the generic `summary` grammar for net sum, gross sum, and ungrouped base-id count while preserving its ordinary paged response. Quotes declare no capability and keep their current passthrough behavior. The detailed route declaration, namespace map, normalized loader type, strict tuple mapping, errors, and OpenAPI expectations follow below.

## Sales route declaration

Only Orders opt in; Quotes remain unchanged:

```ts
summary: {
  maxFields: 3,
  maxDistinctGroupings: 1,
  maxGroupsPerField: 20,
  statementTimeoutMs: 1500,
  fields: {
    grandTotalNetAmount: {
      selector: 'grand_total_net_amount',
      functions: ['sum'],
      scalar: 'decimal',
      groupBy: { publicField: 'currencyCode', selector: 'currency_code' },
    },
    grandTotalGrossAmount: {
      selector: 'grand_total_gross_amount',
      functions: ['sum'],
      scalar: 'decimal',
      groupBy: { publicField: 'currencyCode', selector: 'currency_code' },
    },
    id: { selector: 'id', functions: ['count'], scalar: 'integer' },
  },
}
```

The host requests:

```text
GET /api/sales/orders?<same normalized filters>&summary=grandTotalNetAmount:sum,grandTotalGrossAmount:sum,id:count
```

`packages/core/src/modules/sales/api/documents/factory.ts` and the Orders `listSchema`/`buildDocumentOpenApi` opt into and document the generic alternate envelope. Quote routes declare no summary capability; their current `.passthrough()` list parser ignores a `summary` key, returns the ordinary list response, and leaves Quote OpenAPI unchanged.

## Namespace contract

No namespace is inferred:

| Stable column id | Row accessor | Public summary field | Physical selector | Public group field | Physical group selector | Display group accessor |
|---|---|---|---|---|---|---|
| `grandTotalNetAmount` | `totalNet` | `grandTotalNetAmount` | `grand_total_net_amount` | `currencyCode` | `currency_code` | `currency` |
| `grandTotalGrossAmount` | `totalGross` | `grandTotalGrossAmount` | `grand_total_gross_amount` | `currencyCode` | `currency_code` | `currency` |
| `number` | `number` | `id` | `id` | — | — | — |

Mapping tests assert amount and grouping names in both directions. A column without an explicit public `requestField` cannot join the summary selection.

## DataTable aggregate controller

Add one optional, route-neutral controller:

```ts
type DataTableAggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count'

type DataTableSummaryGroup = {
  key: string | null
  value: string
}

type DataTableSummaryValue = {
  field: string
  fn: DataTableAggregationFn
  groupBy: string | null
  groups: DataTableSummaryGroup[]
}

type DataTableSummary = { values: DataTableSummaryValue[] }

type DataTableSummaryLoader = (
  request: { fields: Array<{ field: string; fn: DataTableAggregationFn }> },
  context: { signal: AbortSignal },
) => Promise<DataTableSummary>

aggregation?: {
  summaryKey: string
  selections: Readonly<Record<string, DataTableAggregationFn>>
  loadSummary: DataTableSummaryLoader
}
```

`selections` has exactly one key namespace: stable TanStack `column.id`. `DataTable` resolves each selected column's current `meta.aggregation.requestField` and supported `functions` before calling `loadSummary`; invalid/hidden/ineligible selections are omitted. Public API fields are never persisted in selection state.

Column metadata maps the stable id to the public request field and formatter:

```ts
meta: {
  aggregation: {
    requestField: 'grandTotalGrossAmount',
    functions: ['sum'],
    responseGroupBy: 'currencyCode',
    groupKeyAccessor: 'currency',
    formatValue: formatAggregateCurrency,
  },
}
```

The host owns `summaryKey`, `selections`, and `loadSummary`. `SalesDocumentsTable` extracts one pure normalized filter serializer used by list and summary URLs; pagination and sort are appended only to the list URL. The loader uses `apiCall(url, { signal })`, validates the outer `{ summary: DataTableSummary }` response, and returns only the normalized inner `summary`. These UI types are exported beside the controller so the controls follow-up reuses them rather than declaring a second shape.

`DataTable` maps each selected column to exactly one response value by the tuple `(meta.aggregation.requestField, selected fn, meta.aggregation.responseGroupBy ?? null)`. Every response entry must correspond to one requested tuple, and every requested tuple must occur exactly once. A missing, duplicate, unrequested, mismatched-function, or mismatched-grouping entry rejects the whole summary result and renders the existing non-blocking unavailable state for all selected footers; partial totals are never displayed. `groups` preserves response order and accepts only `string | null` keys plus canonical string values before the column formatter runs.

`summaryKey` is a stable serialization of the resource identity (`order` plus `/api/sales/orders`), `scopeVersion` from `useOrganizationScopeVersion()`, and the normalized filter query. Selection identity remains a separate controller dependency. An organization-scope change therefore changes the key even when URL filters are identical: `DataTable` aborts the old request, clears old footer values synchronously, and reloads under the new request scope.

`DataTable` owns one `AbortController` and monotonic generation per `summaryKey`/selection combination. A changed key aborts current work, clears old values immediately, and starts a new request if at least one eligible visible selection remains. Aborted or older-generation responses cannot overwrite current state.

## Native footer activation and rendering

Each opted-in Sales column defines `ColumnDef.footer` explicitly. The renderer reads the current summary state from the typed table metadata by stable column id:

```tsx
footer: ({ column, table }) =>
  table.options.meta?.aggregation?.renderFooter(column.id) ?? null
```

This non-null definition activates the prerequisite native `<tfoot>`. The generic renderer handles loading, error, empty, and success state, then delegates value formatting to the column metadata. The footer primitive remains responsible only for aligned semantic table markup.

The visible `number` column maps to public summary field `id` and its footer renders the ungrouped result with plural-aware translated copy (`1 order` / `N orders`); it never displays or persists an internal id. Money fields render each currency group separately (`EUR 12,340.50 — USD 4,100.00`) and never merge currencies. More than three display groups renders the first three plus translated `+N` text with a `SimpleTooltip`; the server still enforces its 20-group cap.

## Temporary Orders affordance

`SalesDocumentsTable` shows a translated outline `Button` labeled “Show totals” with `aria-pressed`:

- disabled: `selections` is `{}` and no summary request runs;
- enabled: `selections` is `{ grandTotalNetAmount: 'sum', grandTotalGrossAmount: 'sum', number: 'count' }`;
- filter changes preserve enabled state but replace the summary key and result;
- the choice is ephemeral and resets on navigation/reload.

When the aggregation-controls follow-up adopts Orders, it removes this button and switches the same controller from external `selections` to the follow-up's mutually exclusive Perspective-controls mode. `DataTable` then derives the one accepted map from its existing active Perspective state. The two affordances never coexist: before that follow-up, Orders has only the temporary toggle; after it, Orders has only per-column controls.

## Exact money formatting

`formatAggregateCurrency(value, currencyCode, locale)` accepts the canonical decimal string directly and never calls `Number(value)`, `parseFloat`, or numeric coercion on the full value. It:

1. validates a signed canonical decimal string;
2. determines the currency's display fraction digits through the existing currency/Intl contract;
3. rounds decimal digits using string/`BigInt` arithmetic with explicit half-up behavior matching current Sales display policy;
4. formats the integer magnitude with `Intl.NumberFormat` using `BigInt` support;
5. inserts the preserved/rounded fractional part and currency placement for the locale.

Invalid scalar/currency input logs a structured internal contract error and renders an em dash. API result strings remain untouched; display rounding is tested independently.

## Data model and indexes

No entity value column changes. Add two named, partial composite indexes to `SalesOrder`, its migration, and the sales snapshot:

- `sales_orders_summary_scope_created_idx` on `(organization_id, tenant_id, created_at, currency_code) WHERE deleted_at IS NULL`;
- `sales_orders_summary_scope_channel_created_idx` on `(organization_id, tenant_id, channel_id, created_at, currency_code) WHERE deleted_at IS NULL`.

Run `yarn db:generate`, keep only the intended sales migration, and update `packages/core/src/modules/sales/migrations/.snapshot-open-mercato.json`. Do not run `yarn db:migrate` in the PR workflow.

Customer filtering continues to use `sales_orders_customer_idx`; tag filtering uses assignment indexes. Capture `EXPLAIN (ANALYZE, BUFFERS)` for scoped-unfiltered, date range, channel+date, customer, amount range, and tag-join summaries on representative high-cardinality data. If a common plan misses the latency target, add only the evidence-driven additive index in the same implementation PR and record it in this spec/changelog.

## UI states

- Disabled: no request and no footer content for aggregate columns.
- Loading: footer cells use the shared spinner and translated loading label; old-key values are cleared.
- Success: single/multiple currencies render as exact separated entries; the order-number footer renders the count once with plural-aware translated `1 order` / `N orders` copy.
- Empty: count is `0`; an entirely empty grouped money result is an em dash.
- Null/invalid currency: group key remains null and renders translated “Unknown currency”; it never merges with a valid code.
- Error/timeout: translated “Totals unavailable” and `SimpleTooltip` detail; table rows remain usable and no toast storm occurs.

No hardcoded user-facing strings, status colors, arbitrary values, inline SVG, or semantic-token `dark:` overrides are introduced.

## Frontend Architecture Contract

### Server/client boundary map

| Surface | Server root | Client island | Data owner |
|---|---|---|---|
| `/backend/sales/orders` | existing generated catch-all | existing `SalesDocumentsTable` and `DataTable` | Sales host serializes filters/loads; DataTable manages generic summary lifecycle |
| `/api/sales/orders?summary=...` | existing CRUD route | none | prerequisite Query Engine aggregation service |

### `"use client"` ledger

| File | Reason | Imported by | Heavy dependencies | Cleanup/hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `packages/ui/src/backend/DataTable.tsx` or focused sibling (existing island) | request lifecycle and footer state | backend lists | existing TanStack only | AbortController/generation cleanup and stable initial disabled state | route-aware server component would couple generic UI to Sales |
| `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx` (existing) | filters, toggle, Sales API loader | Orders list pages | none new | serializer/key must be stable and omit page/sort | putting Sales serialization in `packages/ui` would invert ownership |

### Budgets and evidence

- zero new page-root client components, providers, bootstrap code, or production dependencies;
- zero summary requests while disabled;
- at most one active summary request per table;
- no touched client root grows by more than 120 LOC without extracting a focused helper/component; extracted client files stay below 300 LOC;
- disabled Orders list p50 regression below 2% on the same fixture/run;
- one-million-row scoped fixture: warm summary p95 at or below 500 ms for scoped/date and channel+date; all other common cases complete below the 1,500 ms statement timeout;
- `yarn check:client-boundaries`, hydration/unit tests, `yarn build:app`, and Playwright Orders coverage pass.

## Error and edge behavior

- Stale response after filter change: generation mismatch discards it.
- Browser abort: client ignores abort errors; database timeout is the authoritative server work bound.
- Selected column is hidden: omit it from the request; showing it while totals remain enabled reloads it.
- Public/physical/display names drift: mapping tests fail before release.
- Duplicate tag/custom join matches: one base order contribution.
- More server groups than allowed: no partial total, render non-blocking unavailable state.
- Summary engine/storage unsupported: surface the explicit generic error; never render zero/empty success.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Visible filters and summary filters diverge | High | Sales correctness | one pure serializer and full id/total parity integration | Low: each new filter must extend shared serializer tests |
| Currency values are combined or rounded incorrectly | High | Financial display | server grouping plus exact-string formatter and large-number tests | Low: unsupported currency metadata renders unavailable rather than guessing |
| Stale result appears after filter/resource/scope change | High | Cross-organization UI correctness | key includes resource, filters, `scopeVersion`; AbortController and monotonic generation | Low: provider must continue advancing scopeVersion |
| Orders query adds database load | High | Sales database capacity | separate opt-in request, indexes, 1.5s timeout, EXPLAIN/latency gates | Medium: uncommon filter combinations may time out safely |
| Footer never activates | Medium | Orders UX | explicit `ColumnDef.footer` and DOM regression | Low: future column refactors must preserve explicit footer metadata |
| Shared DataTable regresses | Medium | All table consumers | optional dormant controller and generic state tests | Low: inactive callers remain covered by no-request/no-markup tests |

Rollback removes the Orders `summary` declaration, toggle/controller props, and footer definitions. Additive indexes may remain harmlessly; no row/value rollback is required.

## Test plan

### Route and mapping

- exact public/physical/group mapping for net, gross, count, and currency;
- Orders accepts the three allowed requests and rejects other fields/functions;
- Quotes preserve their current `.passthrough()` query behavior: a `summary` key is ignored, the ordinary list response is returned, and their OpenAPI remains unchanged;
- normal list response/OpenAPI remain present;
- scope/RBAC/filter parity and explicit generic errors.

### DataTable and formatter

- controller dormant when absent or selections empty;
- one selection map keyed by stable column ids and adapted to public fields;
- the visible `number` selection maps to public/physical base id count and renders in that footer;
- hidden/ineligible selections omitted;
- exact outer-envelope normalization and tuple mapping; missing/duplicate/unrequested/mismatched entries fail the whole result closed;
- cancellation, out-of-order responses, filter/resource/`scopeVersion` key changes, cleanup, and one-active-request rule;
- explicit footer definitions activate `<tfoot>` and render loading/error/empty/single/multiple/null-currency states;
- exact formatting for signs, large integer/fraction strings, rounding boundaries, locales, currencies, and invalid values without number coercion.

### Self-contained integration

Create Orders through API fixtures in at least two currencies, one other organization, and duplicate tag assignments with known net/gross totals. Enable totals, assert all footer values including plural-aware `1 order` / `N orders` under the number column, narrow channel/customer/date/tag/search/amount filters, and verify totals update without leaking the other organization. Switch organization scope while retaining identical URL filters and assert the old request is aborted, footers clear immediately, and only the new scope's totals render. Hide/show a selected column and clean up in `finally`. Record EXPLAIN/latency evidence in the implementation PR.

## Implementation plan

1. Add the Orders summary declaration, schema/OpenAPI opt-in, and explicit namespace tests.
2. Add entity index metadata, the sales-only migration/snapshot, and query-plan fixtures.
3. Extract one pure normalized Sales list/summary filter serializer.
4. Add the optional DataTable aggregate controller with a single column-id selection map and cancellation/generation tests.
5. Add explicit aggregate footers, the temporary Orders toggle, exact formatter, locale keys, and UI state tests.
6. Add self-contained multi-currency/scope/join Playwright coverage, performance evidence, and full configured validation.

## Migration & Backward Compatibility

| Surface | Change | Classification | Compatibility behavior |
|---|---|---|---|
| Orders route | opts into generic `summary` mode | Additive | normal paged request/response unchanged |
| Quotes route | none | Unchanged | current passthrough parser ignores `summary`, returns the ordinary list, and exposes no summary OpenAPI |
| DataTable prop/meta | optional controller and metadata | Additive | existing tables render/make no new request |
| Sales column definitions | optional footer renderers | Additive | row/header/accessor behavior unchanged |
| Database | two new partial indexes | Additive-only | no row/value migration; rollback may leave indexes |

No FROZEN id/path/route is renamed or removed. No deprecation bridge or `UPGRADE_NOTES.md` entry is required.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/ui-components.md`

### Compliance Matrix

| Rule Source | Rule | Status | Evidence |
|---|---|---|---|
| root + Sales `AGENTS.md` | Scope every Orders query by tenant/organization and preserve Sales filters | Compliant | summary reuses guarded Orders route/query shape and has cross-org/filter parity tests |
| `packages/core/AGENTS.md` — API Routes | Use `makeCrudRoute`, zod, OpenAPI, and standard errors | Compliant | route-owned declaration extends the existing Orders list contract additively |
| `packages/shared/AGENTS.md` | Exact/validated public contracts; no unsafe selector input | Compliant | strict normalized summary types and tuple validation; selectors remain declared server metadata |
| `packages/ui/AGENTS.md` | Use DataTable and guarded shared patterns | Compliant | existing DataTable receives one optional route-neutral controller; no raw fetch |
| UI backend + design-system guides | Use `apiCall`, shared primitives, i18n, semantic tokens, accessibility | Compliant | loader uses `apiCall`; Button/Spinner/SimpleTooltip and translated plural copy are specified |
| root migration rules | Generate/review only intended migration and snapshot; do not apply locally | Compliant | two evidence-driven Sales indexes and exact generator workflow are named |
| `BACKWARD_COMPATIBILITY.md` | API/UI/database additions are additive | Compliant | Orders opt-in, optional controller/meta, optional footers, and additive indexes preserve normal behavior |
| `.ai/specs/AGENTS.md` | Self-contained API/UI integration coverage | Compliant | mixed-currency, joins, filters, scope switch, empty/error, and cleanup are explicit |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | index/entity plan and public/physical field map are exact |
| API contracts match UI/UX section | Pass | strict response tuples map to explicit stable columns and footer formatters |
| Risks cover all write operations | Pass | only additive index migration writes; rollback is defined |
| Commands defined for all mutations | N/A | runtime summary path is read-only; migration uses normal schema workflow |
| Cache strategy covers all read APIs | Pass | no cache; separate opt-in request, indexes, and timeout bound execution |
| Prerequisite/follow-up contracts agree | Pass | controls replace, never coexist with, the temporary external-selection toggle |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: approved and ready after both prerequisites land.**

## Changelog

| Date | Change |
|---|---|
| 2026-08-01 | Split the first Orders/UI consumer from PR #4455's generic aggregation service; defined route/column namespaces, a single selection map, explicit native-footer activation, exact currency formatting, request lifecycle ownership, indexes/performance budgets, and the temporary-toggle replacement rule. |

### Review — 2026-08-01

- **Reviewer**: Codex fresh-context review
- **Security**: Passed
- **Performance**: Passed with implementation-time EXPLAIN/latency gates
- **Cache**: Passed; no-cache strategy explicit
- **Commands**: N/A for read path; migration workflow compliant
- **Risks**: Passed
- **Verdict**: Approved after prerequisites
