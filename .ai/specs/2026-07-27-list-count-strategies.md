# Capped List Count

## TLDR

**Key Points:**
- Every CRUD list request pays an unconditional `COUNT` round trip built from the full filter/join tree. An exact total over arbitrary filters is `O(matching rows)` by arithmetic — no index, engine, or search backend removes that cost. On a ~1.4M-row table it is ~1.4M units of work on every keystroke of a filter input.
- Bound the count: apply `LIMIT cap + 1` to the existing count subquery. Below the cap the total stays exact; at the cap, report `total: cap` with `totalIsCapped: true` so the UI renders "10 000+".
- **The entire contract change is one optional boolean.** No count mode, no per-call option, no per-endpoint override, no HTTP parameter. The cap is deployment configuration (`OM_LIST_COUNT_CAP`), not part of any API.

**Scope:**
- Apply the cap at the four count sites across `BasicQueryEngine` and `HybridQueryEngine`.
- Add `totalIsCapped?: boolean` to `QueryResult`, the CRUD list payload, and the shared OpenAPI list schema.
- `DataTable` renders "10 000+" and suppresses the last-page jump when the total is capped.
- Convert four full-result-set loops, and one AI tool pack's documented pagination rule, from count-terminated to short-page-terminated.

**Out of scope:** keyset/cursor pagination, a `none`/no-count mode, a per-call or per-endpoint count option, and the O(1) unfiltered total from `entity_index_coverage.base_count`.

**Concerns:**
- A capped total is a *floor*, not a value. Four sites consume `total` as a loop bound over the full result set; converting them is a **correctness prerequisite**, not a follow-up. Capping without the conversion is silent data loss.
- A cap bounds the count's *output*, not its *input* — a selective filter with no usable index still scans the table.
- Above the cap, displayed counts change from an exact number to "10 000+". That is the intended feature, but it is a visible behaviour change for large installations.

---

## Overview

Open Mercato's shared CRUD list pipeline computes an exact `COUNT` for every list request, in addition to the page query. This spec bounds that count so list latency stops scaling with table size, at the cost of reporting "10 000+" instead of an exact number for result sets above a configurable threshold.

The change is deliberately minimal. It adds no entity, no migration, no command, no event, and exactly one optional response field. The bulk of the work is not the cap itself — it is converting the handful of callers that currently treat `total` as ground truth about the full result set.

> **Market Reference**: **GitLab** is the closest analogue — a large open-source Rails application with the same problem on the same database. Its [pagination guidelines](https://docs.gitlab.com/development/database/pagination_guidelines/) state verbatim: *"Avoid presenting total counts, prefer limit counts"*, implemented as *"count maximum 1001 records, and then on the UI show 1000+ if the count is 1001"*. **We adopt this mechanism directly** — the `cap + 1` probe and the "N+" rendering are GitLab's design, scaled to a 10 000 default.
>
> GitLab additionally advises *"Avoid using page numbers, use next and previous page buttons"* and *"As a long-term solution, keyset pagination is preferred."* **We explicitly do not adopt these, for now.** Their rationale is that keyset pagination cannot express page numbers; our position is that a bounded count already bounds page depth (10 000 / 50 = 200 pages), so offset pagination stays acceptable within the cap and the substantially larger keyset migration can be sequenced separately. Adopting the capped count first is a strict prerequisite for that work either way, since it is what makes page numbers finite.
>
> **Shopify** (cursor pagination, no total, no page jumps) and **SAP / Dynamics / NetSuite** (exact count is an explicit opt-in user action) confirm the direction. **Odoo** is the counter-example: `search_count()` on every list view, a well-known scaling failure at millions of rows — which is materially the design Open Mercato has today.

## Problem Statement

Both query engines count unconditionally, and the count query is built by reusing the full data query with `SELECT` and `ORDER BY` stripped — so the entire filter and join tree is executed a second time.

`BasicQueryEngine` (`packages/shared/src/lib/query/engine.ts:912-924`):

```ts
const countExpr = mayMultiplyBaseRows
  ? sql<string>`count(distinct ${sql.ref(`${table}.id`)})`
  : sql<string>`count(*)`
const countBuilder = hasJoinedAggregates
  ? qFull.clearSelect().clearOrderBy().clearGroupBy().select(countExpr.as('count'))
  : qFull.clearSelect().clearOrderBy().select(countExpr.as('count'))
const countRow = await countBuilder.executeTakeFirst()
const total = Number((countRow as any)?.count ?? 0)
```

`HybridQueryEngine` has three further count sites: the optimized base-only path (`packages/core/src/modules/query_index/lib/engine.ts:848-881`), the full-shape path (`:883-897`), and custom-entity document storage (`:1756-1758`).

Measured on staging at ~1.4M orders, even a covering `(organization_id, tenant_id, status) WHERE deleted_at IS NULL` index still yields a parallel sequential scan for the non-selective case, because proving "N rows match" requires visiting N rows. A page of 50 sorted, filtered rows in ~300 ms is achievable; an exact filtered total in ~300 ms is not. Since list filters re-query per keystroke, the count dominates interactive latency.

Nothing in the repository currently short-circuits, caches, or bounds this. There is no `withTotal`, `skipCount`, or count option anywhere.

### Prior art

- **Issue #2227** (closed) optimized `count(distinct id)` → `count(*)` where no join can multiply base rows — visible in the comment at `engine.ts:908-911`. Its two other proposals, *cache the count* and *opt out of count*, went unimplemented.
- **`.ai/specs/2026-05-24-crud-api-performance-quick-wins.md`** sets "<100 ms p50 for CRUD" as the goal and names `COUNT(*)` as a cost line (`:22`, `:36`), but gives it no phase, flag, or acceptance criterion. It explicitly scoped out (`:245-250`) replacing `BasicQueryEngine` or rewriting the query indexer, and its stated invariant is *"no response-shape change"* (`:59`). This spec is the part it scoped out, and it deliberately breaks that invariant in the smallest possible way (one additive optional field).
- **`.ai/specs/SPEC-033-2026-02-18-omnibus-price-tracking.md:371-394`** already ships `includeTotal?: boolean` with verbatim this rationale — *"`total` is omitted by default because a `COUNT(*)` over a filtered time-range on a large history table is expensive"* — but on a new endpoint, so it incurred no backward-compatibility cost.

## Proposed Solution

Apply `LIMIT cap + 1` to the existing count subquery at each of the four count sites:

```ts
if (cap > 0) countBuilder = countBuilder.limit(cap + 1)
```

Below the cap the count returns verbatim with no flag, so small tenants and selective filters see exactly today's numbers. At `cap + 1` rows the engine reports `total: cap` and `totalIsCapped: true`.

Because the count subqueries already strip `ORDER BY`, a capped count is an unordered scan that stops as soon as `cap + 1` rows are produced — constant work regardless of how many rows actually match.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Cap unconditionally; no mode enum, no per-call option | An `exact \| capped` enum implies two implementations where the difference is one optional `LIMIT`. Once the four loop sites stop reading `total`, nothing needs an opt-out, so the option would be unused surface. `OM_LIST_COUNT_CAP=0` remains as an operator-level escape hatch. |
| Report `total: cap`, not `cap + 1` | `cap` is the number the UI renders ("10 000+"). Reporting the probe value would leak an implementation detail into every consumer. |
| Add `totalIsCapped` rather than let clients infer | Inferring capping by comparing `total` against a cap the client does not know mislabels a genuine total of exactly `cap`. One boolean removes the guess. |
| `total` stays `number`, never null/absent | Keeps all four STABLE contract surfaces untouched and reduces the wire change to an additive optional field under `BACKWARD_COMPATIBILITY.md` §7. |
| Convert loops to short-page termination rather than opting them out of the cap | Strictly better code independent of this spec: a count-terminated loop is already wrong when rows are inserted or deleted while it runs. Costs more diff than an opt-out, buys a smaller contract and a latent-bug fix. |
| Cap becomes a hard stop on page depth | 10 000 / 50 = 200 pages. Bounding offset depth is what allows keyset pagination to stay out of scope. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| `count` modes `exact \| capped \| none` per endpoint, overridable per request | Three code paths and a public query parameter to maintain, for an opt-out nothing needs after the loop conversions. `none` additionally omits `total`, which removes a field from an existing response schema — prohibited by `BACKWARD_COMPATIBILITY.md` §7 without the full deprecation protocol. |
| `count: { cap: number \| null }` as a per-call option | An intermediate step that survived one design round. Still unnecessary once the four loop sites terminate on a short page, and it re-introduces a contract field that callers must reason about. |
| Cache the count (per filter signature, tag-invalidated) | Issue #2227's unimplemented proposal. Does not help the interactive case at all — every keystroke is a fresh filter signature, so every keystroke is a cache miss and pays the full count. |
| Postgres `reltuples` estimate | Only valid for an unfiltered table and drifts with autovacuum timing. Wrong for the filtered case, which is the case that hurts. |
| Serve the unfiltered total from `entity_index_coverage.base_count` | Real but narrow: `base_count` is scope-level and filter-blind, so it serves only zero-filter queries. It is also delta-maintained and can drift, producing a wrong total with no visible error. Deferred, not rejected. |
| Keyset/cursor pagination instead | Solves page-depth, not counting — a keyset list still needs a total to render "of N". Substantially larger: `DataTable` has no cursor concept, and sorting spans encrypted columns, custom fields and joins. Deferred to its own spec. |

## Architecture

### Count path today

```
GET /api/<resource>
 └─ makeCrudRoute list handler                         factory.ts:1651
     └─ qe.query(entityId, queryOpts)                  factory.ts:1740
         ├─ HybridQueryEngine.query                    query_index/lib/engine.ts:136
         │   ├─ custom-entity doc storage → count(distinct entity_id)   :1756   ← cap site 3
         │   ├─ optimized  → count(*) over distinct-id subquery         :848    ← cap site 1
         │   ├─ full-shape → count(distinct b.id)                       :885    ← cap site 2
         │   └─ delegate → BasicQueryEngine (no-index / partial / omit-scope)
         └─ BasicQueryEngine.query                     shared/lib/query/engine.ts:207
             └─ count(*) | count(distinct base.id)     shared/.../engine.ts:912  ← cap site 4
     └─ payload { items, total, page, pageSize, totalPages, meta? }     factory.ts:1848
```

The cap applies at all four sites. `HybridQueryEngine` delegates to `BasicQueryEngine` for missing base tables, `omitAutomaticTenantOrgScope`, zero index rows, and partial index coverage — so site 4 is reachable in normal operation, not only in a basic-engine deployment.

### Cap resolution

A single module-level resolver reads `OM_LIST_COUNT_CAP` once (default `10000`, `0` disables capping) and both engines consume it. No cap value travels through `QueryOptions`, request bodies, or the DI container.

### Short-page termination

The four converted loops adopt one shape — collect until a page returns fewer rows than requested:

```ts
let page = 1
for (;;) {
  const res = await qe.query(entityId, { ...queryBase, page: { page, pageSize } })
  const batch = res.items ?? []
  collect(batch)
  if (batch.length < pageSize) break
  page += 1
}
```

This terminates on the true end of the result set regardless of what `total` says, and — unlike the current form — is correct when rows are inserted or deleted mid-loop. Each converted loop also gains a defensive iteration ceiling so a backend misreporting `pageSize` cannot spin indefinitely.

### Commands & Events

None. This spec introduces no command and no event, and subscribes to none.

## Data Models

**No data-model change.** No entity is added, altered, or removed; no migration ships with this spec; `.snapshot-open-mercato.json` is untouched. The existing `entity_index_coverage.base_count` column is referenced only in *Deferred* and is not read by this change.

## API Contracts

### `QueryResult` — `packages/shared/src/lib/query/types.ts:163`

```ts
export type QueryResult<T = any> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  /**
   * True when `total` was bounded by the configured count cap and is therefore a
   * floor, not an exact value: at least `total` rows match. Absent or false means
   * `total` is exact. Additive and optional — callers must treat absence as exact.
   */
  totalIsCapped?: boolean
  meta?: QueryResultMeta
  customFieldDefinitions?: ResolvedCustomFieldDefinitions
}
```

`total` remains required and numeric. The JSDoc mirrors the existing `customFieldDefinitions` convention at `:170-176` for additive internal contract fields.

### CRUD list payload — `packages/shared/src/lib/crud/factory.ts:1848`

```ts
const payload = {
  items: transformedItems,
  total: res.total,
  page: page.page || requestedPage,
  pageSize: page.pageSize || requestedPageSize,
  totalPages: Math.ceil(res.total / (Number(page.pageSize) || 1)),
  ...(res.totalIsCapped ? { totalIsCapped: true } : {}),
  ...(res.meta ? { meta: res.meta } : {}),
}
```

Emitted only when true, matching the existing `meta` spread convention. Every other field is unchanged.

### OpenAPI — `packages/shared/src/lib/openapi/crud.ts:11`

`createPagedListResponseSchema` gains `totalIsCapped: z.boolean().optional()`. `total` stays `z.number()`.

### Request contract

**Unchanged.** No new query parameter, header, or body field on any route.

## Internationalization

Two new keys, alongside the existing `ui.dataTable.pagination.results` at `apps/mercato/src/i18n/en.json:837`:

| Key | English |
|-----|---------|
| `ui.dataTable.pagination.resultsCapped` | `Showing {start} to {end} of {total}+ results` |
| `ui.dataTable.pagination.resultsCappedWithDuration` | `Showing {start} to {end} of {total}+ results in {duration}` |

Added to all eight locale files — `apps/mercato/src/i18n/{en,pl,de,es}.json` and `packages/create-app/template/src/i18n/{en,pl,de,es}.json` — per the create-app Template Sync Checklist. Translations follow the existing per-locale phrasing of the uncapped keys.

## UI/UX

`DataTable`'s `formatPageInfo` callback (`packages/ui/src/backend/DataTable.tsx:2367-2371`) selects the capped key when `pagination.totalIsCapped` is set. `PaginationProps` (`:115-125`) gains `totalIsCapped?: boolean`; every existing field keeps its current type and optionality, so the 67 `DataTable` call sites and 3 `Pagination` call sites compile unchanged.

When the total is capped, the "last page" jump in `packages/ui/src/primitives/pagination.tsx:322-345` is suppressed — jumping to a page derived from a floor implies a precision the data does not have. First/previous/next and the numbered buttons are unaffected and remain bounded by `ceil(cap / pageSize)`.

No new component, no layout change, no new colour or spacing token. `DataTable.tsx:2318`'s `pagination.total === 0` early return is left as-is and stays correct, because `total` is always a real number under this design.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `OM_LIST_COUNT_CAP` | `10000` | Maximum reported list total. `0` disables capping entirely, restoring exact counts globally. |

Mirrored into `apps/mercato/.env.example` and the create-app template per the Template Sync Checklist. Surfaced in `packages/core/src/modules/configs/lib/system-status.ts` alongside the existing `OPTIMIZE_INDEX_COVERAGE_STATS` knob.

## Migration & Backward Compatibility

**No database migration.** No entity, column, or index changes.

**Contract classification** under `BACKWARD_COMPATIBILITY.md`:

| Surface | Change | Classification |
|---------|--------|----------------|
| `QueryResult` (§2 Type Definitions) | Add optional `totalIsCapped` | **Additive — permitted.** No required field removed, none narrowed. |
| CRUD list response (§7 API Routes) | Add optional `totalIsCapped` | **Additive — permitted.** *"MAY add new optional fields to request/response schemas."* No field removed. |
| `PaginationProps` (§3 Function Signatures, `DataTable` row) | Add optional `totalIsCapped` | **Additive — permitted.** *"MUST NOT remove existing props"* — none removed. |
| `QueryEngine.query` signature | Unchanged | — |
| Request schemas | Unchanged | — |

No deprecation protocol, `@deprecated` annotation, bridge, or `UPGRADE_NOTES.md` entry is required, because nothing is removed, renamed, or narrowed.

**The behavioural change** is that `total` becomes a floor for result sets above the cap. `BACKWARD_COMPATIBILITY.md` classifies *fields*, not *values*, so this is not a contract break — but it is the substantive change and the reason the loop conversions ship in the same change rather than after it. Operators who need exact counts unconditionally set `OM_LIST_COUNT_CAP=0`.

**Deployment**: no downtime, no backfill, no ordering constraint against other deploys. Phase 1 is independently correct and can ship and soak before the cap exists.

## Implementation Plan

### Phase 1 — Short-page termination *(independently correct; no cap yet)*

1. Convert the CRUD export loop, `packages/shared/src/lib/crud/factory.ts:1782-1792`, from `while (exportItems.length < total)` to short-page termination; add an iteration ceiling.
2. Convert the custom-entity records export loop, `packages/core/src/modules/entities/api/records.ts:346,357-360`, identically.
3. Convert `findMatchingEntityIdsWithQueryEngine`, `packages/core/src/modules/customers/api/utils.ts:310-329`, replacing the `do … while (ids.size < total)` condition. Callers: `customers/api/deals/route.ts:421`, `people/route.ts:318`, `companies/route.ts:326`.
4. Convert `fetchFilteredProductIds`, `packages/core/src/modules/catalog/widgets/injection/product-bulk-delete/widget.ts:105-125`, replacing the server-derived `totalPages` loop bound.
5. Regression tests asserting each loop enumerates the full result set when `total` under-reports.

### Phase 2 — The cap

1. Add the `OM_LIST_COUNT_CAP` resolver in `packages/shared/src/lib/query/`.
2. Apply `LIMIT cap + 1` and derive `totalIsCapped` at `packages/shared/src/lib/query/engine.ts:912-924`.
3. Apply at the three `HybridQueryEngine` sites: `engine.ts:848-881`, `:883-897`, `:1756-1758`.
4. Add `totalIsCapped` to `QueryResult` (`types.ts:163`), the factory payload (`factory.ts:1848`), the custom-entity payload (`records.ts:347-353`), and `createPagedListResponseSchema` (`openapi/crud.ts:11`).
5. Verify the list response cache (`factory.ts:1470-1521`) round-trips the new field.

### Phase 3 — UI

1. `PaginationProps.totalIsCapped` and capped-key selection in `formatPageInfo` (`DataTable.tsx:115-125`, `:2367-2371`).
2. Suppress the last-page jump when capped (`pagination.tsx:322-345`).
3. Add the two i18n keys across all eight locale files; run `yarn i18n:check-sync`.

### Phase 4 — AI tool packs

1. Surface `totalIsCapped` in the `mapResponse` of the affected `defineApiBackedAiTool` packs (customers `companies`/`deals`/`people`, catalog `products`/`variants`/`configuration`/`prices-offers`/`merchandising`).
2. Update `merchandising-pack.ts:100,269` from *"when `total` exceeds `limit + offset`, call again with the next `offset`"* to a short-page rule, so a capped total cannot stop the model paginating early.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/query/types.ts` | Modify | `totalIsCapped` on `QueryResult` |
| `packages/shared/src/lib/query/engine.ts` | Modify | Cap site 4; cap resolver |
| `packages/core/src/modules/query_index/lib/engine.ts` | Modify | Cap sites 1–3 |
| `packages/shared/src/lib/crud/factory.ts` | Modify | Export loop; payload field |
| `packages/shared/src/lib/openapi/crud.ts` | Modify | Optional schema field |
| `packages/core/src/modules/entities/api/records.ts` | Modify | Export loop; payload field |
| `packages/core/src/modules/customers/api/utils.ts` | Modify | Id-resolution loop |
| `packages/core/src/modules/catalog/widgets/injection/product-bulk-delete/widget.ts` | Modify | Filtered-ids loop |
| `packages/ui/src/backend/DataTable.tsx` | Modify | Prop + capped label |
| `packages/ui/src/primitives/pagination.tsx` | Modify | Suppress last-page jump |
| `apps/mercato/src/i18n/{en,pl,de,es}.json` | Modify | Two keys each |
| `packages/create-app/template/src/i18n/{en,pl,de,es}.json` | Modify | Template sync |
| `apps/mercato/.env.example` + template | Modify | `OM_LIST_COUNT_CAP` |

### Testing Strategy

- **Unit — cap behaviour.** Extend `packages/shared/src/lib/query/__tests__/engine.count-distinct.test.ts` (the #2227 count test) and `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts`: total below cap is exact and unflagged; total at `cap + 1` reports `cap` with `totalIsCapped: true`; `OM_LIST_COUNT_CAP=0` restores today's behaviour; the cap applies on all four sites including the basic-engine delegation paths.
- **Unit — loop conversion.** Each of the four converted loops enumerates the full result set when `total` deliberately under-reports, and terminates on a short final page. This is the regression guard for the data-loss risks below.
- **Unit — payload.** `totalIsCapped` is absent when false and present when true; `total`, `page`, `pageSize`, `totalPages` are byte-identical to today in the uncapped case.
- **Integration** (`.ai/qa/tests/`) — a seeded list above the cap returns `totalIsCapped: true` and a bounded `totalPages`; a CSV export of the same filter contains every row, not `cap` rows.
- **Existing suites** must pass unchanged: no current test asserts a `total` anywhere near 10 000 (largest exact assertions are `317`, `137`, `120`, all mock-backed), so the default cap does not perturb them.

## Risks & Impact Review

#### Export truncation from a count-bounded loop
- **Scenario**: The cap ships without the Phase 1 conversion. `factory.ts:1782-1792` bounds its export loop with `while (exportItems.length < total)`, so a CSV/XLSX export of any filter matching more than the cap stops at exactly `cap` rows and returns HTTP 200 with no warning.
- **Severity**: **Critical** — silent, plausible-looking data loss in a feature users rely on for reporting and migration.
- **Affected area**: Every `makeCrudRoute` list export in the product, plus custom-entity record export (`records.ts:357-360`).
- **Mitigation**: Phase 1 lands first and is independently correct; the cap in Phase 2 cannot regress it. Regression tests assert full enumeration when `total` under-reports.
- **Residual risk**: A future loop written against `total` reintroduces it. Partly addressed by the `totalIsCapped` JSDoc stating `total` is a floor.

#### Advanced-filter result truncation
- **Scenario**: `findMatchingEntityIdsWithQueryEngine` (`customers/api/utils.ts:310-329`) pages with `do … while (ids.size < total)` and feeds the collected ids to `applyEntityIdRestriction`. Under a cap the id set stops at `cap`, so advanced-filtered deals/people/companies lists silently omit every matching record beyond it — and the list's own reported total is then wrong for a second, compounding reason.
- **Severity**: **Critical** — wrong query results presented as complete, in the customers module.
- **Affected area**: `customers/api/{deals,people,companies}/route.ts` advanced filters.
- **Mitigation**: Phase 1 step 3; regression test with a deliberately under-reported total.
- **Residual risk**: None identified once converted; the short-page form has no dependence on count.

#### Filtered bulk delete acting on a subset
- **Scenario**: `fetchFilteredProductIds` (`product-bulk-delete/widget.ts:105-125`) pages via server-derived `totalPages`. Capped, "delete all filtered" collects `cap` ids, shows the user "Delete {count} products matching the current filters?" with that number, and deletes only those — while the user believes the filter was fully applied.
- **Severity**: **High** — destructive operation on an incomplete set, though it under-deletes rather than over-deletes, so nothing is destroyed that the user did not select by filter.
- **Affected area**: Catalog product bulk delete.
- **Mitigation**: Phase 1 step 4.
- **Residual risk**: None once converted.

#### AI agents mis-stating counts and stopping pagination early
- **Scenario**: ~12 `defineApiBackedAiTool` packs lift `total` into `mapResponse` and advertise it. `merchandising-pack.ts:100,269` instructs the model *"when `total` exceeds `limit + offset`, call again with the next `offset`"* — under a cap the model stops after `cap` records and reports "10 000 products" as fact.
- **Severity**: **Medium** — wrong information to the model and to the user, but no data mutation; these are read paths.
- **Affected area**: Customers and catalog AI tool packs, and the same tools exposed over MCP.
- **Mitigation**: Phase 4 surfaces `totalIsCapped` and replaces the documented pagination rule with a short-page rule.
- **Residual risk**: Prompt-level guidance is advisory; a model may still narrate a capped total as exact. Bounded by these being read-only tools.

#### Unbounded loop after removing the count bound
- **Scenario**: A converted loop's termination now depends on a page returning fewer rows than requested. A backend that mis-reports `pageSize`, or an engine path that clamps the page size below the requested value, would return full pages indefinitely.
- **Severity**: **Medium** — a hung request and a worker consumed, no data loss.
- **Affected area**: The four converted loops.
- **Mitigation**: Each loop carries a defensive iteration ceiling (Phase 1 step 1) that logs and aborts rather than spinning.
- **Residual risk**: A truncated export at the ceiling, which is the current behaviour anyway and is logged rather than silent.

#### Counts silently becoming approximate for existing installations
- **Scenario**: An operator upgrades, and lists that previously showed "14 302 results" now show "10 000+". Reports or screenshots built on those figures change without an explicit action.
- **Severity**: **Medium** — expected product behaviour, but unannounced from the operator's perspective.
- **Affected area**: Deals map located-count, entity-link search results, pipeline lane totals, company people badge, webhooks setup widget, and every `DataTable` footer above the cap.
- **Mitigation**: `OM_LIST_COUNT_CAP=0` restores exact counts globally; the "+" suffix makes the approximation visible rather than silent; release notes call it out.
- **Residual risk**: Accepted — this is the feature.

#### Cap does not help selective filters without an index
- **Scenario**: A filter matching 3 rows out of 1.4M with no usable index still scans the table to prove only 3 match. The cap bounds the count's output, not its input, so this case is unimproved.
- **Severity**: **Low** — no regression, only an unmet expectation.
- **Affected area**: Narrow filters on large tables lacking a supporting index.
- **Mitigation**: Stated explicitly here and in the PR so the change is not oversold; indexing remains separate work.
- **Residual risk**: Accepted and documented.

### Tenant & Data Isolation

No new shared or global state: the cap is a read-only process-level constant, and no counter, cache entry, or queue is introduced. All existing tenant/organization scoping is applied before the cap, since the cap is a `LIMIT` on the already-scoped count subquery — it cannot widen a scope. Noisy-neighbour impact is *reduced*: a tenant with millions of rows can no longer force an unbounded count scan on shared database capacity.

### Cascading Failures & Side Effects

No events are emitted or subscribed. No module gains a dependency on another. The list response cache (`factory.ts:1470-1521`) stores the payload verbatim, so a cached capped payload replays consistently; entries written before the upgrade simply lack `totalIsCapped` and are read as exact, which is correct for the values they hold.

### Operational

Blast radius is bounded to list reads and the four converted loops. The failure mode most worth watching is an export or advanced filter returning fewer rows than expected — covered by the Phase 1 regression tests, and reversible in production by setting `OM_LIST_COUNT_CAP=0` without a redeploy of application code. No storage growth, no new rate-limiting surface.

## Final Compliance Report — 2026-07-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `CONTRIBUTING.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No entity or relation added |
| root AGENTS.md | Filter by `organization_id`; never expose cross-tenant data | Compliant | Cap is a `LIMIT` applied after existing scoping; cannot widen scope |
| root AGENTS.md | Never edit generated files by hand | Compliant | No generated file touched |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | Two new i18n keys across all eight locale files |
| root AGENTS.md | No `any` types | Compliant | `totalIsCapped` is `boolean \| undefined` |
| root AGENTS.md | Optimistic locking for new user-editable entities | N/A | No entity introduced |
| root AGENTS.md | Run `yarn generate` after auto-discovery changes | N/A | No module file added or moved |
| root AGENTS.md | Create-app Template Sync Checklist for `.env.example` / app changes | Compliant | `OM_LIST_COUNT_CAP` and both i18n keys mirrored into the template |
| BACKWARD_COMPATIBILITY.md §2 | Optional fields may be added freely; required fields MUST NOT be removed or narrowed | Compliant | `total` unchanged; `totalIsCapped` optional |
| BACKWARD_COMPATIBILITY.md §7 | MUST NOT remove fields from existing response schemas | Compliant | Nothing removed; one optional field added |
| BACKWARD_COMPATIBILITY.md §3 | `DataTable` props MUST NOT be removed | Compliant | Additive optional prop only |
| BACKWARD_COMPATIBILITY.md rule 5 | Contract-surface PRs MUST reference a spec with a Migration & Backward Compatibility section | Compliant | Present above |
| packages/ui/AGENTS.md | Use DS tokens; no arbitrary values or hardcoded status colours | Compliant | No new styling; label text only |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | No new route; shared schema updated additively |
| .ai/specs/AGENTS.md | Required sections present; risks document scenario/severity/area/mitigation/residual | Compliant | Seven risks in the required format |
| .ai/specs/AGENTS.md | No new `SPEC-*` filename prefix | Compliant | `2026-07-27-list-count-strategies.md` |
| CONTRIBUTING.md | Spec registered in `.ai/specs/README.md` with a dated changelog | Compliant | Row added to the Pending table; changelog below |
| .ai/qa/AGENTS.md | Integration coverage for affected API paths ships with the change | Deferred | This PR is spec-only; coverage is specified in Testing Strategy and ships with the implementation |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data model; API adds one optional field |
| API contracts match UI/UX section | Pass | `totalIsCapped` produced by the engine, forwarded by the factory, consumed by `DataTable` |
| Risks cover all write operations | Pass | The only write-adjacent path is filtered bulk delete, covered as its own risk |
| Commands defined for all mutations | N/A | No mutation introduced |
| Cache strategy covers all read APIs | Pass | Existing list cache round-trips the new field; Phase 2 step 5 verifies |
| Every cited file:line verified against the tree | Pass | All references checked at `e5ad6e8` |

### Non-Compliant Items

None blocking. One deferred item: integration tests are specified but not shipped, because this contribution is the specification only — noted in the matrix and in the PR description.

### Verdict

**Fully compliant** — approved for implementation, pending upstream agreement on the behavioural change to `total` above the cap.

## Changelog

### 2026-07-27
- Initial specification.
- Scope resolved to counts only; keyset/cursor pagination split to a separate future spec.
- Design reduced across three rounds: `exact | capped | none` modes → nullable per-call cap → an unconditional cap with a single additive response field, after establishing that no caller needs an exact-count opt-out once the full-result-set loops terminate on a short page.
- Added *Correctness prerequisites* (Phase 1) after an audit found four sites using `total` as a loop bound: CRUD export, custom-entity export, customers advanced-filter id resolution, and catalog filtered bulk delete.
- Market reference verified against GitLab's published pagination guidelines; the `cap + 1` probe and "N+" rendering are adopted from it, its keyset and no-page-numbers guidance explicitly deferred with rationale.
