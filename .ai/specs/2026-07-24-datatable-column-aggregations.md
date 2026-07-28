# DataTable Column Aggregations (Totals Footer)

> **Status**: Draft
> **Scope**: OSS (`packages/ui`, `packages/shared`, `packages/core`)
> **Created**: 2026-07-24
> **Related**: PR #3972 (`feat(ui): native DataTable column footers via tfoot`), [`2026-04-03-advanced-datatable-ux.md`](./implemented/2026-04-03-advanced-datatable-ux.md), [`SPEC-070-2026-04-04-perspectives-views-panel.md`](./SPEC-070-2026-04-04-perspectives-views-panel.md), [`2026-07-05-datatable-column-resize.md`](./2026-07-05-datatable-column-resize.md)

---

## TLDR

Give the shared `DataTable` a real, opt-in **column aggregation footer**: a user can total (or average/count) a numeric column and see the result in a `<tfoot>` aligned under that column. The number is computed **server-side across the whole filtered result set** (not just the current page), is **currency-aware** (grouped by currency, never summing mixed currencies into one meaningless figure), stays **filter-aware** (re-computes when filters change), and is fetched as a **separate, non-blocking request** so it never slows the list. Enabled aggregations are **per-column view state persisted in the user's Perspective**, and are toggled from a new **per-column header menu**.

The work is layered so each layer ships and is testable on its own:

- **Phase A** — land the presentational primitive (PR #3972's native `<tfoot>` via TanStack `columnDef.footer`) and give it a **self-contained example page + e2e** so it can be exercised manually and in CI without any backend.
- **Phase B1** — generic **server-side aggregation**: an additive `QueryEngine` aggregation capability, a `makeCrudRoute` summary mode, a column-`meta` convention, and the **sales orders list** as the first real consumer (opt-in "totals", currency-grouped). Ships with e2e on the orders page.
- **Phase B2** — **interactivity + persistence**: the first per-column header dropdown menu to toggle aggregations, and the Perspective-schema extension that makes the choice sticky per user. Ships with e2e.

No aggregation across currencies is ever shown as a single number. Nothing changes for existing tables until a column opts in.

---

## Overview

**Who it is for.** Any backend user of any `DataTable` list — the driving case is a sales operator on `/backend/sales/orders` who has filtered to a channel and date range and needs the total value of that selection.

**What it adds.** Three composable pieces, each behind an opt-in: a `<tfoot>` in the shared `DataTable` (presentational), a generic aggregation capability on the query engine surfaced through a `summary` mode on any CRUD list route (data), and a per-column header menu whose choice persists in the user's Perspective (interaction).

**What it deliberately is not.** Not FX conversion (no as-of rates — mixed currencies are grouped, never merged), not in-body grouping/pivot rows, not aggregation of encrypted or custom-field values, and not an orders-specific feature: the orders list is the first consumer of a generic capability, not the place the logic lives.

**Why it is shaped this way.** The two things that make a totals footer non-trivial are correctness and cost. Correctness means the whole filtered set (not the page), deduplicated base rows (joins can multiply), and per-currency grouping. Cost means a tenant with millions of orders who never asks for a total pays nothing — hence opt-in per column, and a separate non-blocking request rather than extra work on every list load.

---

## Problem Statement

`DataTable` (used by every backend list page) has **no way to show a column total**. The only footer mechanism today is the `:footer` **widget-injection spot** (`packages/ui/src/backend/DataTable.tsx` ~L1364, rendered ~L3260), which renders a free-form `div` **below** the table and **cannot align a sum under its column**. There is no `<tfoot>`, no aggregation model, and no server endpoint that returns a total for a filtered list.

Concretely, on the orders list (`https://demo.openmercato.com/backend/sales/orders`) there is no way to answer "what is the total gross value of the orders matching my current filters?". Building it naively has three traps:

1. **Wrong scope** — summing only the current page (≤100 rows) produces a number that changes as the user pages and is meaningless for a paginated list.
2. **Performance** — a total over *all* matching rows means an aggregate query. On a tenant with millions of orders, running it **unconditionally on every list load** (on top of the pagination `COUNT(*)` the engine already runs) is wasteful, and an aggregate over **unindexed filter columns** can degrade to a sequential scan.
3. **Multi-currency** — order rows carry a **per-row currency** (`SalesDocumentRow.currency` ← `doc.currencyCode`, `SalesDocumentsTable.tsx` L73/L473); a list can mix EUR/USD/GBP. `SUM(grand_total_gross_amount)` across mixed currencies is a lie.

The feature must be **general** (any numeric column on any list, not an orders-only hack), **correct** (whole filtered set, currency-aware), and **cheap by default** (opt-in, non-blocking, so the million-order tenant who never asks pays nothing).

---

## Goals / Non-Goals

**Goals**
- A native `<tfoot>` in `DataTable` that renders per-column aggregate values, aligned under the column, backward-compatible (dormant until a column opts in).
- Server-side, filter-aware, tenant/org-scoped aggregates (`sum`, `avg`, `min`, `max`, `count`) over the whole matching set.
- Currency-correct display: aggregates group by a currency field and never collapse mixed currencies into one number.
- Opt-in per column via a header menu; the choice persists in the user's Perspective.
- Generic reuse: any CRUD list route and any numeric column can enable aggregation with a column-`meta` flag — no per-page bespoke code.
- Full manual + e2e testability at every phase.

**Non-Goals**
- FX conversion to a base/tenant currency (requires as-of rates; explicitly out of scope — we group by currency instead).
- Cross-column or computed aggregations (e.g. weighted averages, ratios).
- Grouped/pivot rows inside the body (`getGroupedRowModel`); this spec is footer totals only.
- Role-default aggregations via `RolePerspective` (per-user only in this spec; noted as a follow-up).
- Aggregating encrypted columns or custom-field/JSONB values in Phase B1 (see Risks; gated to plain numeric base columns first).

---

## Proposed Solution

### Layering overview

```
Phase A  (presentational)   DataTable <tfoot> from columnDef.footer  ── PR #3972 + self-contained example + e2e
Phase B1 (data)             QueryEngine.aggregate → makeCrudRoute summary mode → column meta → orders page consumer + e2e
Phase B2 (interaction)      per-column header menu → Perspective `aggregations` persistence + e2e
```

Each layer is independently valuable and independently mergeable. Phase A has no backend dependency; B1 delivers the real feature for orders; B2 makes it interactive and sticky and — because B1 is generic — lights up for every aggregatable column on every list at once.

**Scope decision (maintainer):** the three phases ship as **separate PRs**, not one. Phase A is PR #3972 plus the example/e2e addition and is a prerequisite for B1's footer rendering. B1 is the core capability and is acceptance-complete on its own (opt-in toggle, no header menu, no persistence). B2 is deferable without blocking B1 — if it slips, B1 still ships usable totals. They stay in **one spec** because they share a single contract (the `aggregate` engine option, the `summary` wire shape, and the column `meta` convention): splitting the document would force those decisions to be made in B1 and re-litigated in B2. One spec, three PRs.

### Phase A — presentational footer + example (PR #3972 hardening)

PR #3972 already adds the native `<tfoot>`: `DataTable` renders `table.getFooterGroups()` through the `TableFooter` primitive (`packages/ui/src/primitives/table.tsx` L79) whenever at least one merged column defines a TanStack `footer` (`ReactNode` or `(ctx) => ReactNode`); no footer ⇒ no `<tfoot>` (backward compatible). Footer cells mirror header/body layout (bulk-selection leading spacer, `responsiveClass`, sticky-first-column treatment, trailing actions spacer).

**This spec's addition to Phase A**: a **self-contained example** and **e2e**, because a shared primitive currently has only unit tests and the reviewer feedback on #3972 is "needs a real example that can be tested manually and in e2e."

- Example: a minimal, backend-free DataTable page/story fixture (fixed in-memory rows) whose numeric column declares `footer: () => formatMoney(total)` with a precomputed total, demonstrating both the "server-precomputed total passed as a node" pattern and correct column alignment.
- e2e: drives the example page, asserts a single `<tfoot>` renders, the total cell is under the correct column, and that a table with no footer column renders **no** `<tfoot>`.

### Phase B1 — generic server-side aggregation

#### B1.1 — `QueryEngine` aggregation capability (additive)

The generic `QueryEngine` contract (`packages/shared/src/lib/query/types.ts`) today exposes only `query(entity, opts): Promise<QueryResult>` — paginated find, no aggregation. `BasicQueryEngine` (`packages/shared/src/lib/query/engine.ts`) already builds a **companion count query** (clears select/orderBy, selects `count(*)` / `count(distinct id)`, ~L896–923) to fill `QueryResult.total`. We extend the **same** builder to optionally compute aggregates over the identical filtered/scoped/joined set:

- Add an optional field to `QueryOptions`. **Grouping is per-field, not global** — a request routinely mixes money fields (which must group by currency) with `count` (which must not); a single top-level `groupBy` would return one count per currency and make the footer's single count cell ambiguous:
  ```ts
  aggregate?: {
    fields: Array<{
      field: string
      fn: 'sum' | 'avg' | 'min' | 'max' | 'count'
      groupBy?: string      // e.g. currency column; omit for currency-agnostic aggregates
      alias?: string        // defaults to `${field}:${fn}`
    }>
  }
  ```
- Add an optional block to `QueryResult`. Fields sharing a `groupBy` are merged into one group set; ungrouped fields land in a single `groupKey: null` entry:
  ```ts
  aggregates?: {
    groups: Array<{ groupBy: string | null; groupKey: string | null; values: Record<string, number> }>
  }
  ```
- `BasicQueryEngine` derives an aggregate builder from the full query (same filters, joins, tenant/org scope) selecting `COALESCE(SUM(col::numeric),0)` etc. (mirroring the dashboards `buildAggregateExpression`, `packages/core/src/modules/dashboards/lib/aggregations.ts` L32). Distinct `groupBy` values require distinct `GROUP BY` clauses, so the engine emits **one aggregate query per distinct `groupBy`** (in practice one or two) rather than attempting a single query.
- **Deduplication invariant (correctness-critical).** Aggregates MUST be computed over **deduplicated base rows**. The engine already recognises that joins can multiply base rows and switches its count to `count(distinct base.id)` under exactly that condition (`packages/shared/src/lib/query/engine.ts` L908–918: `hasJoinedAggregates || opts.joins?.length || opts.customFieldSources?.length`). `SUM`/`AVG` applied naively to the same builder would count a €100 order once per matching join row. When that condition holds, the aggregate MUST run over a base-id-deduplicated relation (group-by-`base.id` subquery / CTE, then aggregate the outer relation) rather than the joined builder directly. `SUM(DISTINCT col)` is **not** an acceptable substitute — two different orders may legitimately have equal amounts. `MIN`/`MAX` are duplication-safe; `COUNT` reuses the existing distinct logic. The exact SQL construction is left to implementation; the invariant and its test are not.
- `HybridQueryEngine` forwards `aggregate` to the underlying engine (custom-field/search-decorated path unaffected — aggregatable fields are plain base columns; see Risks). Note this does **not** exempt the invariant above: the aggregated *column* is a plain base column, but the *filter* may still join custom fields or extensions and multiply rows.

This is an **additive** change to a STABLE contract surface (new optional option + new optional result field); existing callers are unaffected. See [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md).

#### B1.2 — `makeCrudRoute` summary mode

`makeCrudRoute` (`packages/shared/src/lib/crud/factory.ts`) gains an opt-in **summary request mode** so any CRUD list can serve aggregates using the exact same filter parsing it already uses (guaranteeing filter parity):

- Request: the existing list route with `summary=1` and an aggregation spec, e.g.
  `GET /api/sales/orders?<existing filters>&summary=grandTotalNetAmount:sum:currencyCode,grandTotalGrossAmount:sum:currencyCode,id:count`

  Each `summary` entry is `<field>:<fn>[:<groupBy>]`. The optional third segment carries the per-field grouping (see B1.1); omitting it requests an ungrouped aggregate. There is no `summaryGroupBy` param — a single global grouping cannot express "money per currency, count once".
- When `summary` is present, the handler **skips item hydration/enrichment** and returns only the aggregate envelope — it is a lightweight, standalone request the client fires **in parallel** with (and independently of) the page request, so list latency is never coupled to aggregate latency:
  ```jsonc
  {
    "summary": {
      "groups": [
        { "groupBy": "currencyCode", "groupKey": "EUR", "values": { "grandTotalNetAmount:sum": 12340.50, "grandTotalGrossAmount:sum": 14000.00 } },
        { "groupBy": "currencyCode", "groupKey": "USD", "values": { "grandTotalNetAmount:sum": 4100.00,  "grandTotalGrossAmount:sum": 4520.00 } },
        { "groupBy": null,           "groupKey": null,  "values": { "id:count": 37 } }
      ]
    }
  }
  ```
  A column's footer reads the group set matching its own `meta.currencyField` (or the `groupBy: null` entry when it declares none), so a currency-agnostic `count` renders exactly once regardless of how many currencies the money columns split into.
- Aggregatable fields **and their `groupBy` fields** are validated against a route-declared allow-list (only columns the route opts into); unknown/disallowed field, fn, or groupBy → 400. The summary respects the identical tenant/org scope and RBAC guard as the list (no new ACL feature).
- Opt-in per route: a route enables it by declaring `summary: { fields: [{ field, fns, groupBy? }] }` in its CRUD options; `hooks.afterList` (already used by the sales factory, `packages/core/src/modules/sales/api/documents/factory.ts` ~L513) is available for routes that need a bespoke summary but the generic path covers the common case.

Rejected alternative — computing the sum inside `afterList` on the **normal** list request: it either runs on every load (perf regression) or forces the client to call the list endpoint twice, re-running item hydration just to get a scalar. The standalone summary mode avoids both.

Rejected alternative — the dashboards aggregation service (`buildAggregationQuery` + `POST /api/dashboards/widgets/data`, with `sales:orders` already registered in `sales/analytics.ts`): its filter DSL differs from the CRUD list's Mongo-style `Where`, so filter parity would require a translation layer. Reusing the list route's own `buildFilters` is simpler and correct by construction. (We do reuse its SQL aggregate-expression shape.)

#### B1.3 — Column `meta` convention

Column meta is an untyped bag already read ad hoc in `DataTable` (nearest informal type: `packages/ui/src/backend/utils/useAutoDiscoveredFields.ts` L13). Add an aggregation hint:

```ts
meta: {
  aggregatable: true,
  aggregations: ['sum', 'avg'],          // offered in the header menu
  aggregationField: 'grandTotalGrossAmount', // server field to aggregate (defaults to accessorKey)
  currencyField: 'currency',             // row/group currency for display + groupBy
  format: 'money',                       // reuse formatCurrency / formatMoney
}
```

Only columns with `aggregatable: true` render a footer cell and (in B2) offer the header menu item. Optionally introduce a typed `ColumnMeta` augmentation (`declare module '@tanstack/react-table'`) — none exists today; if added it is additive.

#### B1.4 — Orders list consumer

- `SalesOrder` already has `grand_total_net_amount` / `grand_total_gross_amount` (numeric(18,4), `sales/data/entities.ts` L451/L454) and each row a `currency` (`SalesDocumentsTable.tsx` L73/L473). The orders route declares `summary: { fields: [{ field: 'grandTotalNetAmount', fns: ['sum','avg'], groupBy: 'currencyCode' }, { field: 'grandTotalGrossAmount', fns: ['sum','avg'], groupBy: 'currencyCode' }, { field: 'id', fns: ['count'] }] }`.
- `SalesDocumentsTable` gains an **opt-in** "Show totals" affordance (Phase B1 can ship this as a simple toggle; B2 replaces it with the per-column header menu). When enabled, it fires the summary request (same filters, in parallel), and the gross/net columns declare `footer` nodes that render the returned per-currency values via the existing `formatCurrency` (`SalesDocumentsTable.tsx` L119).
- **Footer rendering rule**:
  - single currency in the result → one clean formatted number (`€12,340.50`).
  - multiple currencies → compact per-currency list (`€12,340.50 · $4,100.00`) or the dominant currency with a "+N" affordance and full breakdown on hover/popover. **Never** one summed number.
- e2e: orders page with fixtures in ≥2 currencies; enable totals; assert the footer shows per-currency sums matching the fixtures and updates when a filter narrows the set.

### Phase B2 — header menu + Perspective persistence

#### B2.1 — Per-column header menu (first of its kind)

The header cell today (`DataTable.tsx` ~L3003–3052) is a single ghost `Button` that toggles sort; there is **no** per-column dropdown anywhere. Introduce a per-header menu (`DropdownMenu`) whose trigger sits alongside the sort control, initially hosting only aggregation actions ("Sum", "Average", "Count", "None") for `aggregatable` columns. Non-aggregatable columns show no trigger. (The menu is a natural future home for sort asc/desc, hide, and pin — out of scope here, but the component should be built so those can be added without a rewrite.)

#### B2.2 — Perspective persistence

`PerspectiveSettings` (`packages/shared/src/modules/perspectives/types.ts`) is a **closed, validated** schema (Zod `z.object`, strips unknown keys) persisted as `perspectives.settings_json` (JSON, per-user, tenant/org-scoped). Adding aggregations is additive but must be applied in **all** of:

1. `packages/shared/src/modules/perspectives/types.ts` — add `aggregations?: Record<string, 'sum' | 'avg' | 'min' | 'max' | 'count'>` to `PerspectiveSettings`.
2. `packages/core/src/modules/perspectives/data/validators.ts` — add the field to `perspectiveSettingsSchema` (otherwise the server silently drops it — the schema is not `.passthrough()`).
3. `packages/ui/src/backend/DataTable.tsx` — the client `sanitizePerspectiveSettings` allow-list (~L553–595) and the build-current-settings memo (~L1710–1720) must copy the new key.

No migration is needed (`settings_json` is untyped JSON; older rows simply lack the key). The localStorage snapshot envelope is version-gated (`v: 1`, `DataTable.tsx` ~L497); a purely additive optional field does **not** require a version bump. When a perspective loads with `aggregations`, the table fires the summary request for those columns and renders footers; toggling from the header menu writes back through the existing `useGuardedMutation` perspective save path (resourceKind `'perspective'`).

- e2e: enable "Sum" on a column via the header menu, reload, assert the footer persists (perspective round-trip).

---

## Architecture

### Data flow (Phase B enabled)

```
List page (SalesDocumentsTable)
  ├─ page request   GET /api/sales/orders?<filters>&page=..        → items + total   (unchanged, never blocked)
  └─ summary request GET /api/sales/orders?<filters>&summary=...   → { summary.groups[] }   (parallel, only when a column aggregation is active)
                                   │
                                   ▼
        makeCrudRoute summary mode  ── reuses buildFilters + tenant/org scope + RBAC guard
                                   │
                                   ▼
        QueryEngine.query(entity, { ...filters, aggregate: { fields: [{ field, fn, groupBy? }] } })
                                   │
                                   ▼
        BasicQueryEngine: full filtered/scoped builder → base-id-deduplicated relation → aggregate builder
            (one query per distinct groupBy; grouped money + ungrouped count)
                                   │
                                   ▼
        DataTable <tfoot>: per-column footer node renders the matching group set (currency-aware)
```

### Key touch points

| Concern | File(s) |
|---|---|
| Native `<tfoot>` rendering | `packages/ui/src/backend/DataTable.tsx`, `packages/ui/src/primitives/table.tsx` (`TableFooter`) |
| Aggregation engine option/result | `packages/shared/src/lib/query/types.ts`, `packages/shared/src/lib/query/engine.ts` (+ `HybridQueryEngine`) |
| Summary route mode | `packages/shared/src/lib/crud/factory.ts` |
| Orders route declaration | `packages/core/src/modules/sales/api/orders/route.ts`, `packages/core/src/modules/sales/api/documents/factory.ts` |
| Orders consumer UI | `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`, `salesDocumentsColumns.ts` |
| Column meta type (optional) | `packages/ui/src/backend/utils/useAutoDiscoveredFields.ts` (or a new shared column-meta type) |
| Header menu | `packages/ui/src/backend/DataTable.tsx` (new per-header `DropdownMenu`) |
| Perspective persistence | `packages/shared/src/modules/perspectives/types.ts`, `packages/core/src/modules/perspectives/data/validators.ts`, `packages/ui/src/backend/DataTable.tsx` |
| Money formatting | `SalesDocumentsTable.tsx` `formatCurrency`; `sales/components/documents/lineItemUtils.ts` `formatMoney` |

---

## Frontend Architecture Contract

- **Server/Client boundary:** unchanged. The summary handler is server (Node), inside the existing `makeCrudRoute` list route — no new route file, no new App Router page, no new provider or bootstrap scope. Every touched UI file is already a client component.
- **`"use client"` ledger:** no new entries. `DataTable.tsx` and `SalesDocumentsTable.tsx` are already `"use client"`; the footer cells, the B2 header menu, and the summary fetch live inside them. If implementation extracts a new component (e.g. `ColumnAggregationMenu`), it is client and presentational, and this ledger must be updated in the same PR.
- **Client-blob guardrail:** no new dependency enters the list bundle. Footers reuse the existing `TableFooter` primitive, the header menu reuses the existing `DropdownMenu`, and money rendering reuses `formatCurrency`/`formatMoney`. No charting or formatting library is added.
- **Budgets / evidence:** **N/A for route/bundle/RAM budgets** — no new route, no new dependency, and the added client code is a footer row plus a dropdown on an already-heavy shared component. Evidence required at implementation time is the narrower thing that can actually regress: (a) `build:app` output shows no material bundle delta on the orders route, and (b) the orders list p50 is unchanged when no aggregation is active (the default path fires no summary request at all).
- **Request ownership & lifecycle (design decision, not an implementation detail):** the summary request is owned by the table, keyed by the same filter/scope state as the page request, and is **generation-guarded** — each dispatch carries a monotonically increasing token (or an `AbortController` retained per key) and a response whose token is stale is **discarded, not rendered**. Without this, narrowing a filter while a slow aggregate is in flight lets the older, wider total overwrite the newer one and silently display a wrong number that never self-corrects. While a summary request is in flight for a changed filter set, the footer renders a loading state rather than the previous value.
- **Hydration/interactivity tests:** unit coverage that the footer renders only for `aggregatable` columns and that a stale-token response does not overwrite a newer one; e2e that the footer hydrates with real values, updates on filter change, and (B2) that header-menu toggling and sort-on-header-click remain independently operable.

---

## Data Models

No new entities. No database migration.

- `PerspectiveSettings` gains optional `aggregations?: Record<string, AggregationFn>` (JSON-backed in `perspectives.settings_json`).
- `QueryOptions.aggregate` / `QueryResult.aggregates` are in-memory contract additions (no persistence).
- Aggregatable source columns (e.g. `grand_total_net_amount`, `grand_total_gross_amount`) already exist as `numeric(18,4)`; **an index on the common filter columns** (`created_at`, `channel_id`, `customer_entity_id`, `grand_total_*` ranges) should be verified/added so the aggregate uses an index scan rather than a seq scan (see Risks R2).

---

## API Contracts

- **Additive query param on existing CRUD list routes** (opt-in per route): `summary=<field>:<fn>[:<groupBy>],...`. Returns `{ summary: { groups: Array<{ groupBy: string|null, groupKey: string|null, values: Record<string, number> }> } }` and omits `items`. Same auth/tenant/org scope and RBAC as the list. Disallowed field/fn/groupBy → 400.
- No new standalone endpoint, no new ACL feature, no new event.
- Response envelope of the normal list request is **unchanged** (still `items/total/page/pageSize/totalPages/meta?`).

---

## Migration & Backward Compatibility

Required by [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) §5 for any spec touching a contract surface.

| Contract surface | Change | Classification | Impact on third-party modules |
|---|---|---|---|
| `QueryOptions` (STABLE type) | new optional `aggregate` field | **ADDITIVE-ONLY** | None. Existing callers omit it; engines that ignore it return no `aggregates`. |
| `QueryResult` (STABLE type) | new optional `aggregates` block | **ADDITIVE-ONLY** | None. Consumers destructuring known keys are unaffected. |
| `QueryEngine` interface | no signature change (option/result carry the capability) | **UNCHANGED** | None. Third-party engine implementations that ignore `aggregate` stay compilable and correct — a route requesting a summary from such an engine gets no `aggregates` and the footer renders empty rather than wrong. |
| CRUD list route query params | new optional `summary` param, opt-in per route | **ADDITIVE-ONLY** | None. Routes that do not declare `summary` reject it as an unknown param exactly as today. |
| CRUD list response envelope | unchanged for normal requests | **UNCHANGED** | None. |
| `makeCrudRoute` options | new optional `summary` declaration | **ADDITIVE-ONLY** | None. |
| `PerspectiveSettings` (validated Zod schema) | new optional `aggregations` key | **ADDITIVE-ONLY** | None. `settings_json` is untyped JSON; rows written before this change simply lack the key and load as "no aggregations". |
| DataTable column `meta` | new optional `aggregatable`/`aggregations`/`aggregationField`/`currencyField` keys | **ADDITIVE-ONLY** | None. `meta` is an open bag; columns without the keys behave exactly as today. |
| `TableFooter` / `<tfoot>` rendering | dormant unless a column defines `footer` | **ADDITIVE-ONLY** | None. Tables with no footer column render no `<tfoot>` (Phase A guarantee). |

- **No FROZEN surface is touched.** No removal, rename, or signature change anywhere; the deprecation protocol (`@deprecated` + bridge + `UPGRADE_NOTES.md`) is therefore **not required** and no `UPGRADE_NOTES.md` entry is needed.
- **No database migration.** No new entity, column, or index-bearing schema change is introduced by the contract; the index verification in Data Models is an operational check on existing filter columns, not a migration shipped by this spec.
- **Forward migration path:** if FX conversion (explicit non-goal) is added later, it extends `aggregate.fields[]` with an optional target-currency field — additive again, and the per-field `groupBy` shape chosen in B1.1 accommodates it without a breaking rewrite.

---

## Risks & Impact Review

| ID | Risk | Severity | Affected area | Mitigation | Residual |
|----|------|----------|---------------|------------|----------|
| R1 | Aggregate query runs on every list load and regresses p50 for large tenants | High | Perf / sales list | Opt-in per column; separate, parallel request fired **only** when an aggregation is active; never blocks the page request | Users who keep totals on pay one extra aggregate query per load (acceptable; cacheable) |
| R2 | Aggregate over unindexed filter columns → seq scan on millions of rows | High | DB perf | Verify/add indexes on common order filter columns; aggregate reuses the same filtered builder as the (already-indexed) count companion | Rare filter combinations may still scan; bounded by opt-in |
| R3 | Summing mixed currencies yields a meaningless number | High | Correctness | `GROUP BY currency`; footer renders per-currency; never one merged sum | Busy footer when many currencies (compact + hover breakdown) |
| R4 | Perspective `aggregations` silently dropped by server (closed Zod schema) | Medium | Persistence | Update type + validator + client allow-list together (3 files); add a test asserting round-trip | — |
| R5 | Contract surface changes to shared `QueryEngine` interface | Medium | Third-party modules | Additive optional option/field only; existing callers unaffected; documented in spec | — |
| R6 | Aggregating encrypted / custom-field / JSONB columns produces wrong or failing SQL | Medium | Correctness | Gate `aggregatable` to plain numeric base columns in B1; explicitly out of scope for encrypted/CF; route allow-list enforces it | CF/encrypted aggregation deferred |
| R7 | New per-header dropdown is the first of its kind — UX/regression risk in a heavily-used primitive | Medium | UI | Isolate in B2; dormant unless a column is `aggregatable`; keep header click-to-sort behavior intact; unit + e2e | — |
| R8 | Footer must stay aligned with sticky first column, bulk-select spacer, actions column, virtualization | Medium | UI | Reuse #3972's footer layout that already mirrors header/body spacers and sticky shadows | — |
| R9 | Coexistence with the existing `:footer` injection spot (rendered outside `<table>`) | Low | UI | Independent surfaces; both can render; documented | — |
| R10 | Row-multiplying joins inflate `SUM`/`AVG` — filtering on a multi-valued custom field or an extension join makes a €100 order contribute once per join row, silently overstating the total | High | Correctness | Dedup invariant in B1.1: aggregate over a base-id-deduplicated relation whenever the engine's existing `mayMultiplyBaseRows` condition holds (`engine.ts` L908–918); regression test filters by a multi-valued CF and asserts the sum is unchanged | Invariant is enforced by test, not by the type system — a future join source added without extending the condition could reintroduce it |
| R11 | A stale in-flight summary response overwrites a newer one, showing a total that does not match the visible filters and never self-corrects | High | Correctness / UI | Generation-guarded request ownership (Frontend Architecture Contract); stale-token responses discarded; loading state while a changed filter set is in flight | — |

---

## Test Plan

- **Phase A**: unit (renders `<tfoot>` when a column defines `footer`; renders none otherwise — already in #3972) + **new self-contained e2e** on an example page (footer present, aligned under the right column, absent when no footer column).
- **Phase B1**: engine unit tests (`sum/avg/min/max/count`, per-field `groupBy`, tenant/org scope applied, filter parity with the list); route test (summary mode reuses filters, rejects disallowed field/fn/groupBy with 400, omits items); **orders e2e** (≥2 currencies fixture, enable totals, per-currency sums correct, updates on filter change). Fixtures created via API in setup and cleaned up in teardown (`.ai/qa/AGENTS.md`).
  - **Required regression — join multiplication (R10)**: a fixture where the filtered set joins a row-multiplying source (a multi-valued custom field, an `includeExtensions` join, and an explicit `joins` entry — one case each). Assert `SUM` equals the hand-computed per-order total, **not** a multiple of it, and that the same query's `total` and `count` agree with it. This test must fail against a naive aggregate applied to the joined builder.
  - **Required regression — mixed grouping (B1.2)**: one request combining currency-grouped money fields with an ungrouped `count`; assert the count appears exactly once with `groupBy: null` and is not duplicated per currency.
- **Phase B2**: header-menu unit test (toggle sets aggregation, only on aggregatable columns); perspective round-trip test (save → reload → footer persists); **stale-response test (R11)** — dispatch two summary requests, resolve them out of order, assert the older response is discarded; **e2e** enabling "Sum" from the menu and asserting persistence across reload.

Integration coverage for every affected API path and key UI path is enumerated per phase above (spec requirement).

---

## Resolved Decisions

4. **Currency of "count"** — **Resolved**: grouping is **per-field**, not per-request (B1.1). Currency-agnostic aggregates omit `groupBy` and return a single `groupBy: null` group, so `count` renders once regardless of how many currencies the money columns split into. A single global `groupBy` was rejected precisely because it cannot express this.

## Open Questions

1. **Header-menu ambition** — ship a minimal aggregation-only menu (recommended) or the general per-column menu (sort/hide/pin/aggregate) in the same PR? Default: minimal, built to extend.
2. **B1 opt-in affordance** — a simple "Show totals" toggle in B1 (replaced by the header menu in B2), or wait and land the header menu directly? Default: simple toggle in B1 so B1 is demoable without B2.
3. **Line-item count total** — also expose `lineItemCount` as an aggregatable (`sum`) column on orders? Default: yes, cheap.
5. **Role-default aggregations** (`RolePerspective`) — deferred; confirm out of scope.

These remaining questions are **UI-affordance and scope choices that do not change any contract**; each has a stated default and none blocks starting B1.

---

## Final Compliance Report

**Reviewed**: 2026-07-28.

**`AGENTS.md` files reviewed** (via the root Task Router rows matching this task — DataTable/CrudForm UI, query engine, CRUD routes, perspectives, testing, spec conventions):

- [`AGENTS.md`](../../AGENTS.md) (root — Architecture, Data & Security, UI & HTTP, Code Quality, Design System, Backward Compatibility)
- [`packages/shared/AGENTS.md`](../../packages/shared/AGENTS.md) (query/data engine types, i18n, request scoping)
- [`packages/ui/AGENTS.md`](../../packages/ui/AGENTS.md) + [`packages/ui/src/backend/AGENTS.md`](../../packages/ui/src/backend/AGENTS.md) (DataTable guidelines, `apiCall`, loading/error states)
- [`packages/core/AGENTS.md`](../../packages/core/AGENTS.md) (API routes, `makeCrudRoute`, query engine integration, access control)
- [`packages/core/src/modules/sales/AGENTS.md`](../../packages/core/src/modules/sales/AGENTS.md) (orders list consumer)
- [`.ai/specs/AGENTS.md`](./AGENTS.md) (spec structure and content checklist)
- [`.ai/qa/AGENTS.md`](../qa/AGENTS.md) (integration coverage, self-contained fixtures)
- [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) (contract-surface classification, §5 spec requirement)
- [`.ai/ds-rules.md`](../ds-rules.md) (tokens, no arbitrary values)

| Rule / requirement | Source | Status | Evidence |
|---|---|---|---|
| Spec includes TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, Risks, Final Compliance Report, Changelog | `.ai/specs/AGENTS.md:91` | Compliant | All ten sections present; `## Overview` added in this revision (it was the one missing heading) |
| Migration & Backward Compatibility section for contract-touching specs | `BACKWARD_COMPATIBILITY.md:11` (§5) | Compliant | Dedicated section with per-surface classification table |
| Contract changes classified; deprecation protocol where needed | `BACKWARD_COMPATIBILITY.md` | Compliant | All ADDITIVE-ONLY / UNCHANGED; no FROZEN surface touched ⇒ protocol N/A |
| Frontend Architecture Contract for UI/client-boundary work | om-spec-writing heuristic #9 | Compliant | Dedicated section; boundary map + ledger + guardrail + request lifecycle; route/bundle/RAM budgets marked N/A with reason (no new route or dependency) |
| Risks document failure scenario, severity, area, mitigation, residual | `.ai/specs/AGENTS.md` | Compliant | R1–R11, incl. R10 join multiplication and R11 stale response |
| Integration coverage for every affected API path and key UI path, shipped in the same change | root `AGENTS.md` → Documentation and Specifications; `.ai/qa/AGENTS.md` | Compliant | Test Plan enumerates per phase; R10/R11 regressions are named as required |
| Integration tests self-contained (API fixtures, cleaned up in teardown) | `.ai/qa/AGENTS.md` | Compliant | Test Plan, Phase B1 |
| Tenant/org scoping on all queries; no cross-tenant exposure | root `AGENTS.md` → Architecture | Compliant | Aggregates reuse the list's scoped, RBAC-guarded builder; no new ACL feature |
| No direct cross-module ORM relationships | root `AGENTS.md` → Architecture | Compliant | No new entity or relation; sales consumes the generic route capability |
| `apiCall` not raw `fetch`; guarded mutations | root `AGENTS.md` → UI & HTTP | Compliant | Summary fetch via `apiCall`; perspective write via existing `useGuardedMutation` path |
| No hardcoded user-facing strings | root `AGENTS.md` → UI & HTTP | Compliant | "Show totals", "Sum", "Average", "Count", "Total", multi-currency hint via `useT()`/locale files; internal errors prefixed `[internal]` |
| DS tokens only; no hardcoded status colors or arbitrary values | `.ai/ds-rules.md` | Compliant | Existing `TableFooter` + `bg-background`/sticky shadow tokens; existing `DropdownMenu` primitive |
| No `any`; zod-validated inputs | root `AGENTS.md` → Data & Security, Code Quality | Compliant | Summary params zod-parsed against the route allow-list; `aggregate`/`aggregates` typed |
| No database migration introduced without generator workflow | root `AGENTS.md` → Data & Security | N/A | No schema change; index verification is operational, not a shipped migration |
| Optimistic locking on new user-editable entities | root `AGENTS.md` → Always | N/A | No new entity; perspective writes already covered by the perspectives module |

**Internal consistency check**: passed. The per-field `groupBy` shape is stated identically in B1.1 (engine option), B1.2 (wire param + envelope), B1.4 (orders declaration), the Architecture data-flow diagram, the API Contracts section, and Resolved Decision #4. The dedup invariant appears in B1.1 and is carried into R10 and the Test Plan. The scope decision (one spec, three PRs) is stated in the Layering overview and reflected in the phase-scoped Test Plan.

**Non-compliant items**: none. Three open questions remain (header-menu ambition, B1 opt-in affordance, line-item count), all UI-affordance/scope choices with stated defaults that touch no contract surface and do not block B1.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-24 | Initial spec — layered plan (A: primitive + example/e2e; B1: generic server-side currency-aware aggregation + orders consumer; B2: header menu + Perspective persistence). Open questions pending. |
| 2026-07-28 | Revision after automated review on PR #4455. Added the base-row deduplication invariant for `SUM`/`AVG` over row-multiplying joins (R10 + required regression test). Moved aggregate grouping from a single global `groupBy` to **per-field** `groupBy`, resolving the mixed money/count ambiguity (Open Question #4) and updating the engine option, wire param, response envelope, orders declaration, and data-flow diagram. Added the Frontend Architecture Contract, including generation-guarded summary-request ownership to prevent stale responses overwriting newer totals (R11 + test). Added the required Migration & Backward Compatibility section with a per-surface classification table. Made the phase-scope decision explicit (one spec, three independently mergeable PRs; B2 deferable). Expanded the Final Compliance Report into a dated rule/status/evidence matrix with reviewed `AGENTS.md` list, internal-consistency result, and non-compliant items. Added the missing `## Overview` section required by the spec content checklist. |
