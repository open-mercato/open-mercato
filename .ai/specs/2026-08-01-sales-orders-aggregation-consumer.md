# Sales Orders Filtered Aggregation Consumer

> **Status**: Draft — ready for implementation
> **Scope**: OSS (`packages/ui`, `packages/core` sales)
> **Created**: 2026-08-01
> **Prerequisites**: [`2026-08-01-datatable-native-column-footers.md`](./2026-08-01-datatable-native-column-footers.md), [`2026-07-24-datatable-column-aggregations.md`](./2026-07-24-datatable-column-aggregations.md)
> **Follow-up**: [`2026-08-01-datatable-aggregation-controls.md`](./2026-08-01-datatable-aggregation-controls.md)

## TLDR

Adopt the generic CRUD aggregation service on `/backend/sales/orders`: add an allow-listed summary declaration and evidence-driven indexes, reuse one filter serializer for list and summary requests, and render exact currency-separated net/gross totals plus record count in native column footers. A temporary translated “Show totals” toggle proves the end-to-end capability without persisting preferences. `DataTable` owns only generic request cancellation/generation/footer state; the Sales host owns route serialization and loading.

## Resolved assumptions

| Question | Decision | Rationale |
|---|---|---|
| Initial affordance | One ephemeral list-level “Show totals” toggle | Proves the consumer without bundling the follow-up per-column persistence capability |
| Selected functions | Fixed `sum` for net/gross and `count` for id while enabled | Keeps this consumer deterministic; function choice belongs to the controls follow-up |
| Money grouping | Group each money field by currency | Cross-currency sums are invalid without an FX policy |
| Precision | Format canonical decimal strings without `Number(value)` | Preserves exact API results beyond IEEE-754 range |
| Selection identity | One map keyed only by stable TanStack column id | Avoids duplicated selection ownership and keeps public request-field mapping in column metadata |
| Footer activation | Each aggregate column defines an explicit `ColumnDef.footer` renderer | Satisfies the native footer primitive's opt-in contract |
| Controls adoption | The follow-up replaces the temporary toggle for Orders; it does not coexist | Prevents conflicting request precedence and enabled-state rules |
| Line-item totals, role defaults, FX | Deferred | Each is independent policy/capability work |

## Problem

Sales operators filter Orders by channel, customer, date, tags, search, or amount and need totals over the entire matching result set. Summing the current page is wrong. A second filter implementation is also unsafe because it can drift from the visible list's scope and query semantics.

The generic backend service solves the server contract but intentionally has no UI ownership. This consumer must map the Sales API, physical schema, row accessors, column ids, and display currency explicitly; bind one request lifecycle to the current filters; and preserve exact money values through rendering.

## Goals

- Opt `/api/sales/orders` into route-declared `sum` for net/gross and `count` for id.
- Reuse the exact normalized list filters for the separate summary request, excluding page and sort.
- Render currency-separated totals aligned to the net, gross, and record-count columns.
- Make no summary request while totals are disabled.
- Cancel/discard stale responses when filters or selections change.
- Add bounded database indexes and `EXPLAIN`/latency evidence for common Sales filters.
- Provide self-contained, mixed-currency, cross-organization, duplicate-join integration coverage.

## Non-goals

- User-persisted or per-column function choices; that is the linked controls spec.
- FX conversion, line-item totals, quote summaries, custom-field aggregate selectors, cache, or role defaults.
- Changes to the generic backend aggregate service or native footer semantics.

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

`packages/core/src/modules/sales/api/documents/factory.ts` and the Orders `listSchema`/`buildDocumentOpenApi` opt into and document the generic alternate envelope. No quote route accepts `summary` in this phase.

## Namespace contract

No namespace is inferred:

| Stable column id | Row accessor | Public summary field | Physical selector | Public group field | Physical group selector | Display group accessor |
|---|---|---|---|---|---|---|
| `grandTotalNetAmount` | `totalNet` | `grandTotalNetAmount` | `grand_total_net_amount` | `currencyCode` | `currency_code` | `currency` |
| `grandTotalGrossAmount` | `totalGross` | `grandTotalGrossAmount` | `grand_total_gross_amount` | `currencyCode` | `currency_code` | `currency` |
| `id` | `id` | `id` | `id` | — | — | — |

Mapping tests assert amount and grouping names in both directions. A column without an explicit public `requestField` cannot join the summary selection.

## DataTable aggregate controller

Add one optional, route-neutral controller:

```ts
type DataTableAggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count'

aggregation?: {
  summaryKey: string
  selections: Readonly<Record<string, DataTableAggregationFn>>
  loadSummary: (
    request: { fields: Array<{ field: string; fn: DataTableAggregationFn }> },
    context: { signal: AbortSignal },
  ) => Promise<DataTableSummary>
}
```

`selections` has exactly one key namespace: stable TanStack `column.id`. `DataTable` resolves each selected column's current `meta.aggregation.requestField` and supported `functions` before calling `loadSummary`; invalid/hidden/ineligible selections are omitted. Public API fields are never persisted in selection state.

Column metadata maps the stable id to the public request field and formatter:

```ts
meta: {
  aggregation: {
    requestField: 'grandTotalGrossAmount',
    functions: ['sum'],
    groupKeyAccessor: 'currency',
    formatValue: formatAggregateCurrency,
  },
}
```

The host owns `summaryKey`, `selections`, and `loadSummary`. `SalesDocumentsTable` extracts one pure normalized filter serializer used by list and summary URLs; pagination and sort are appended only to the list URL. The loader uses `apiCall(url, { signal })` and defensively validates the generic response.

`DataTable` owns one `AbortController` and monotonic generation per `summaryKey`/selection combination. A changed key aborts current work, clears old values immediately, and starts a new request if at least one eligible visible selection remains. Aborted or older-generation responses cannot overwrite current state.

## Native footer activation and rendering

Each opted-in Sales column defines `ColumnDef.footer` explicitly. The renderer reads the current summary state from the typed table metadata by stable column id:

```tsx
footer: ({ column, table }) =>
  table.options.meta?.aggregation?.renderFooter(column.id) ?? null
```

This non-null definition activates the prerequisite native `<tfoot>`. The generic renderer handles loading, error, empty, and success state, then delegates value formatting to the column metadata. The footer primitive remains responsible only for aligned semantic table markup.

The `id` footer renders the ungrouped count. Money fields render each currency group separately (`EUR 12,340.50 — USD 4,100.00`) and never merge currencies. More than three display groups renders the first three plus translated `+N` text with a `SimpleTooltip`; the server still enforces its 20-group cap.

## Temporary Orders affordance

`SalesDocumentsTable` shows a translated outline `Button` labeled “Show totals” with `aria-pressed`:

- disabled: `selections` is `{}` and no summary request runs;
- enabled: `selections` is `{ grandTotalNetAmount: 'sum', grandTotalGrossAmount: 'sum', id: 'count' }`;
- filter changes preserve enabled state but replace the summary key and result;
- the choice is ephemeral and resets on navigation/reload.

When the aggregation-controls follow-up adopts Orders, it removes this button and supplies the same controller's `selections` from the current Perspective. The two affordances never coexist: before that follow-up, Orders has only the temporary toggle; after it, Orders has only per-column controls.

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
- Success: single/multiple currencies render as exact separated entries; count renders once.
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

## Risks and rollback

| Risk | Severity | Mitigation |
|---|---|---|
| Visible filters and summary filters diverge | High | one pure serializer and full id/total parity integration |
| Currency values are combined or rounded incorrectly | High | server grouping plus exact-string formatter and large-number tests |
| Stale result appears under new filters | High | AbortController, stable key, monotonic generation |
| Orders query adds database load | High | separate opt-in request, indexes, 1.5s timeout, EXPLAIN/latency gates |
| Footer never activates | Medium | explicit `ColumnDef.footer` and DOM regression |
| Shared DataTable regresses | Medium | optional dormant controller and generic state tests |

Rollback removes the Orders `summary` declaration, toggle/controller props, and footer definitions. Additive indexes may remain harmlessly; no row/value rollback is required.

## Test plan

### Route and mapping

- exact public/physical/group mapping for net, gross, count, and currency;
- Orders accepts the three allowed requests and rejects other fields/functions;
- Quotes remain unchanged and reject summary mode;
- normal list response/OpenAPI remain present;
- scope/RBAC/filter parity and explicit generic errors.

### DataTable and formatter

- controller dormant when absent or selections empty;
- one selection map keyed by stable column ids and adapted to public fields;
- hidden/ineligible selections omitted;
- cancellation, out-of-order responses, key changes, cleanup, and one-active-request rule;
- explicit footer definitions activate `<tfoot>` and render loading/error/empty/single/multiple/null-currency states;
- exact formatting for signs, large integer/fraction strings, rounding boundaries, locales, currencies, and invalid values without number coercion.

### Self-contained integration

Create Orders through API fixtures in at least two currencies, one other organization, and duplicate tag assignments with known net/gross totals. Enable totals, assert all footer values, narrow channel/customer/date/tag/search/amount filters, verify totals update and do not leak the other organization, hide/show a selected column, and clean up in `finally`. Record EXPLAIN/latency evidence in the implementation PR.

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
| Quotes route | none | Unchanged | summary remains unsupported |
| DataTable prop/meta | optional controller and metadata | Additive | existing tables render/make no new request |
| Sales column definitions | optional footer renderers | Additive | row/header/accessor behavior unchanged |
| Database | two new partial indexes | Additive-only | no row/value migration; rollback may leave indexes |

No FROZEN id/path/route is renamed or removed. No deprecation bridge or `UPGRADE_NOTES.md` entry is required.

## Final compliance report — 2026-08-01

- One independently deployable capability: the Sales Orders adoption of the prerequisite aggregate service/footer primitive.
- Route, physical, row, column, group, and display namespaces are explicit.
- Host, DataTable, footer primitive, and backend service each have singular ownership.
- Selection state has one stable-column-id namespace; footer activation is explicit.
- Precision, scope, join deduplication, indexes, timeout, frontend boundaries, i18n/DS, performance, and self-contained integration gates are specified.
- Persisted controls explicitly replace the temporary toggle later and cannot conflict with it.

**Verdict:** fully specified and ready after both prerequisites land.

## Changelog

| Date | Change |
|---|---|
| 2026-08-01 | Split the first Orders/UI consumer from PR #4455's generic aggregation service; defined route/column namespaces, a single selection map, explicit native-footer activation, exact currency formatting, request lifecycle ownership, indexes/performance budgets, and the temporary-toggle replacement rule. |
