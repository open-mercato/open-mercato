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

### Phase A — presentational footer + example (PR #3972 hardening)

PR #3972 already adds the native `<tfoot>`: `DataTable` renders `table.getFooterGroups()` through the `TableFooter` primitive (`packages/ui/src/primitives/table.tsx` L79) whenever at least one merged column defines a TanStack `footer` (`ReactNode` or `(ctx) => ReactNode`); no footer ⇒ no `<tfoot>` (backward compatible). Footer cells mirror header/body layout (bulk-selection leading spacer, `responsiveClass`, sticky-first-column treatment, trailing actions spacer).

**This spec's addition to Phase A**: a **self-contained example** and **e2e**, because a shared primitive currently has only unit tests and the reviewer feedback on #3972 is "needs a real example that can be tested manually and in e2e."

- Example: a minimal, backend-free DataTable page/story fixture (fixed in-memory rows) whose numeric column declares `footer: () => formatMoney(total)` with a precomputed total, demonstrating both the "server-precomputed total passed as a node" pattern and correct column alignment.
- e2e: drives the example page, asserts a single `<tfoot>` renders, the total cell is under the correct column, and that a table with no footer column renders **no** `<tfoot>`.

### Phase B1 — generic server-side aggregation

#### B1.1 — `QueryEngine` aggregation capability (additive)

The generic `QueryEngine` contract (`packages/shared/src/lib/query/types.ts`) today exposes only `query(entity, opts): Promise<QueryResult>` — paginated find, no aggregation. `BasicQueryEngine` (`packages/shared/src/lib/query/engine.ts`) already builds a **companion count query** (clears select/orderBy, selects `count(*)` / `count(distinct id)`, ~L896–923) to fill `QueryResult.total`. We extend the **same** builder to optionally compute aggregates over the identical filtered/scoped/joined set:

- Add an optional field to `QueryOptions`:
  ```ts
  aggregate?: {
    fields: Array<{ field: string; fn: 'sum' | 'avg' | 'min' | 'max' | 'count' }>
    groupBy?: string        // e.g. currency column, for currency-safe totals
  }
  ```
- Add an optional block to `QueryResult`:
  ```ts
  aggregates?: {
    groups: Array<{ groupKey: string | null; values: Record<string, number> }>
  }
  ```
- `BasicQueryEngine` derives an aggregate builder from the full query (same filters, joins, tenant/org scope) selecting `COALESCE(SUM(col::numeric),0)` etc. (mirroring the dashboards `buildAggregateExpression`, `packages/core/src/modules/dashboards/lib/aggregations.ts` L32) plus an optional `GROUP BY groupBy`. `count` maps to the existing distinct/plain count logic.
- `HybridQueryEngine` forwards `aggregate` to the underlying engine (custom-field/search-decorated path unaffected — aggregatable fields are plain base columns; see Risks).

This is an **additive** change to a STABLE contract surface (new optional option + new optional result field); existing callers are unaffected. See [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md).

#### B1.2 — `makeCrudRoute` summary mode

`makeCrudRoute` (`packages/shared/src/lib/crud/factory.ts`) gains an opt-in **summary request mode** so any CRUD list can serve aggregates using the exact same filter parsing it already uses (guaranteeing filter parity):

- Request: the existing list route with `summary=1` and an aggregation spec, e.g.
  `GET /api/sales/orders?<existing filters>&summary=grandTotalNetAmount:sum,grandTotalGrossAmount:sum&summaryGroupBy=currencyCode`
- When `summary=1`, the handler **skips item hydration/enrichment** and returns only the aggregate envelope — it is a lightweight, standalone request the client fires **in parallel** with (and independently of) the page request, so list latency is never coupled to aggregate latency:
  ```jsonc
  {
    "summary": {
      "groups": [
        { "currency": "EUR", "values": { "grandTotalNetAmount": 12340.50, "grandTotalGrossAmount": 14000.00 } },
        { "currency": "USD", "values": { "grandTotalNetAmount": 4100.00,  "grandTotalGrossAmount": 4520.00 } }
      ]
    }
  }
  ```
- Aggregatable fields are validated against a route-declared allow-list (only columns the route opts into); unknown/disallowed fields → 400. The summary respects the identical tenant/org scope and RBAC guard as the list (no new ACL feature).
- Opt-in per route: a route enables it by declaring `summary: { fields: [...], groupBy?: 'currencyCode' }` in its CRUD options; `hooks.afterList` (already used by the sales factory, `packages/core/src/modules/sales/api/documents/factory.ts` ~L513) is available for routes that need a bespoke summary but the generic path covers the common case.

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

- `SalesOrder` already has `grand_total_net_amount` / `grand_total_gross_amount` (numeric(18,4), `sales/data/entities.ts` L451/L454) and each row a `currency` (`SalesDocumentsTable.tsx` L73/L473). The orders route declares `summary: { fields: ['grandTotalNetAmount','grandTotalGrossAmount'], groupBy: 'currencyCode' }`.
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
        QueryEngine.query(entity, { ...filters, aggregate: { fields, groupBy } })
                                   │
                                   ▼
        BasicQueryEngine: full filtered/scoped builder → aggregate builder
            SELECT currency, COALESCE(SUM(grand_total_gross_amount::numeric),0) ... GROUP BY currency
                                   │
                                   ▼
        DataTable <tfoot>: per-column footer node renders summary.groups (currency-aware)
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

## Data Models

No new entities. No database migration.

- `PerspectiveSettings` gains optional `aggregations?: Record<string, AggregationFn>` (JSON-backed in `perspectives.settings_json`).
- `QueryOptions.aggregate` / `QueryResult.aggregates` are in-memory contract additions (no persistence).
- Aggregatable source columns (e.g. `grand_total_net_amount`, `grand_total_gross_amount`) already exist as `numeric(18,4)`; **an index on the common filter columns** (`created_at`, `channel_id`, `customer_entity_id`, `grand_total_*` ranges) should be verified/added so the aggregate uses an index scan rather than a seq scan (see Risks R2).

---

## API Contracts

- **Additive query param on existing CRUD list routes** (opt-in per route): `summary=<field>:<fn>,...` and optional `summaryGroupBy=<field>`. Returns `{ summary: { groups: Array<{ currency?: string|null, values: Record<string, number> }> } }` and omits `items`. Same auth/tenant/org scope and RBAC as the list.
- No new standalone endpoint, no new ACL feature, no new event.
- Response envelope of the normal list request is **unchanged** (still `items/total/page/pageSize/totalPages/meta?`).
- Contract-surface classification (per `BACKWARD_COMPATIBILITY.md`): all additions are **ADDITIVE-ONLY** (new optional query param; new optional `QueryOptions`/`QueryResult` fields; new optional `PerspectiveSettings` key; new optional column `meta`). No FROZEN surface is touched; no deprecation protocol required.

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

---

## Test Plan

- **Phase A**: unit (renders `<tfoot>` when a column defines `footer`; renders none otherwise — already in #3972) + **new self-contained e2e** on an example page (footer present, aligned under the right column, absent when no footer column).
- **Phase B1**: engine unit tests (`sum/avg/min/max/count`, `groupBy` currency, tenant/org scope applied, filter parity with the list); route test (summary mode reuses filters, rejects disallowed fields with 400, omits items); **orders e2e** (≥2 currencies fixture, enable totals, per-currency sums correct, updates on filter change). Fixtures created via API in setup and cleaned up in teardown (`.ai/qa/AGENTS.md`).
- **Phase B2**: header-menu unit test (toggle sets aggregation, only on aggregatable columns); perspective round-trip test (save → reload → footer persists); **e2e** enabling "Sum" from the menu and asserting persistence across reload.

Integration coverage for every affected API path and key UI path is enumerated per phase above (spec requirement).

---

## Open Questions

1. **Header-menu ambition** — ship a minimal aggregation-only menu (recommended) or the general per-column menu (sort/hide/pin/aggregate) in the same PR? Default: minimal, built to extend.
2. **B1 opt-in affordance** — a simple "Show totals" toggle in B1 (replaced by the header menu in B2), or wait and land the header menu directly? Default: simple toggle in B1 so B1 is demoable without B2.
3. **Line-item count total** — also expose `lineItemCount` as an aggregatable (`sum`) column on orders? Default: yes, cheap.
4. **Currency of "count"** — `count` is currency-agnostic; render it once (not per-currency) even when other columns group by currency. Confirm rendering.
5. **Role-default aggregations** (`RolePerspective`) — deferred; confirm out of scope.

---

## Final Compliance Report

- **Backward compatibility**: all changes ADDITIVE-ONLY (optional query param, optional engine option/result fields, optional `PerspectiveSettings` key, optional column meta). No FROZEN/STABLE surface removed or changed. No migration.
- **Tenant safety**: aggregates run through the same tenant/org-scoped, RBAC-guarded builder as the list; no new cross-tenant surface.
- **DS compliance**: footer uses the existing `TableFooter` primitive + `bg-background`/sticky shadow tokens (no hardcoded colors, no arbitrary sizes); header menu uses the existing `DropdownMenu` primitive.
- **i18n**: new user-facing strings ("Show totals", "Sum", "Average", "Count", "Total", multi-currency hint) routed through `useT()` / locale files; internal errors prefixed `[internal]`.
- **HTTP/UI**: summary fetch uses `apiCall`; any perspective write uses the existing `useGuardedMutation` path (optimistic locking already handled by the perspectives module).
- **Performance**: opt-in + separate non-blocking request + index verification; default cost for non-users is zero.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-24 | Initial spec — layered plan (A: primitive + example/e2e; B1: generic server-side currency-aware aggregation + orders consumer; B2: header menu + Perspective persistence). Open questions pending. |
