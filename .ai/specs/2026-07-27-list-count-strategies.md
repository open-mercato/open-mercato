# Capped List Count

## TLDR

**Key Points:**
- Every CRUD list request pays an unconditional `COUNT` round trip. An exact total over arbitrary filters is `O(matching rows)` by arithmetic — no index, engine, or search backend removes that cost. On a ~1.4M-row table it is ~1.4M units of work on every keystroke of a filter input.
- Bound the count so the database stops at `cap + 1` matching rows. Below the cap the total stays exact; at the cap, report `total: cap` with `totalIsCapped: true` so the UI renders "10 000+".
- **Bounding the count requires rebuilding the count query, not adding a `LIMIT` to the existing one.** Today the count is derived from the *display* query with `SELECT`/`ORDER BY` stripped, so it inherits projection joins, a `GROUP BY`, and a `count(distinct)`. A `LIMIT` above an aggregate is a no-op, and a `LIMIT` above a `GROUP BY` is blocked by `HashAggregate`. The count must be built independently: scope + filters only, row-multiplying joins expressed as `EXISTS` semi-joins, projection joins omitted.
- The wire change is one optional boolean plus one optional `meta` warning. `total` stays `number` on every path.

**Scope:**
- Rebuild the count query at the four count sites across `BasicQueryEngine` and `HybridQueryEngine`, and bound it with `LIMIT cap + 1`.
- Add `totalIsCapped?: boolean` to the CRUD list payload and the shared OpenAPI list schema; add `listCountCapWarning` to `QueryResultMeta`.
- Convert six full-result-set loops, and two AI prompt sites, from count-terminated to short-page-terminated — and make them fail closed.
- Decouple the encrypted-sort truncation warning from `total`.
- `DataTable` renders "10 000+" and suppresses the last-page jump when the total is capped.

**Out of scope:** keyset/cursor pagination, a `none`/no-count mode, a per-call or per-endpoint count option, and the O(1) unfiltered total from `entity_index_coverage.base_count`.

**Concerns:**
- A capped total is a *floor*, not a value. Six sites consume `total` as a loop bound over the full result set; converting them is a **correctness prerequisite**, not a follow-up. Capping without the conversion is silent data loss.
- A cap bounds the count's *output*, not its *input* — a selective filter with no usable index still scans the table.
- There is **no centralized client-side pagination helper** in this repo, so surfacing the flag in the UI is per-call-site work across ~49 server-backed `DataTable` sites. Because the cap is on by default, Phase 3 must cover all of them rather than a subset.
- The cap is **on by default** (`OM_LIST_COUNT_CAP=10000`). This is an accepted minor breaking change: above the cap, displayed counts become "10 000+" and page depth is bounded. `OM_LIST_COUNT_CAP=0` restores exact counts and stays permanently supported.

---

## Overview

Open Mercato's shared CRUD list pipeline computes an exact `COUNT` for every list request, in addition to the page query. This spec bounds that count so list latency stops scaling with table size, at the cost of reporting "10 000+" instead of an exact number for result sets above a configurable threshold.

The change adds no entity, no migration, no command, and no event. The work is concentrated in three places: rebuilding the count query so a bound is actually enforceable, converting the callers that treat `total` as ground truth about the full result set, and rolling the behaviour change out without surprising existing installations.

> **Market Reference**: **GitLab** is the closest analogue — a large open-source Rails application with the same problem on the same database. Its [pagination guidelines](https://docs.gitlab.com/development/database/pagination_guidelines/) state verbatim: *"Avoid presenting total counts, prefer limit counts"*, implemented as *"count maximum 1001 records, and then on the UI show 1000+ if the count is 1001"*. **We adopt this mechanism directly** — the `cap + 1` probe and the "N+" rendering are GitLab's design, scaled to a 10 000 default.
>
> GitLab additionally advises *"Avoid using page numbers, use next and previous page buttons"* and *"As a long-term solution, keyset pagination is preferred."* **We explicitly do not adopt these, for now.** Their rationale is that keyset pagination cannot express page numbers; our position is that a bounded count already bounds page depth (10 000 / 50 = 200 pages), so offset pagination stays acceptable within the cap and the substantially larger keyset migration can be sequenced separately. Adopting the capped count first is a strict prerequisite for that work either way, since it is what makes page numbers finite.
>
> **Shopify** (cursor pagination, no total, no page jumps) and **SAP / Dynamics / NetSuite** (exact count is an explicit opt-in user action) confirm the direction. **Odoo** is the counter-example: `search_count()` on every list view, a well-known scaling failure at millions of rows — which is materially the design Open Mercato has today.

## Problem Statement

Both query engines count unconditionally. The root cause is not that they count — it is *how the count query is constructed*: by reusing the full data query and stripping `SELECT`/`ORDER BY`. That reuse drags projection machinery into a query that only needs to answer "how many".

`BasicQueryEngine` (`packages/shared/src/lib/query/engine.ts:912-923`):

```ts
const mayMultiplyBaseRows =
  hasJoinedAggregates ||
  (Array.isArray(opts.joins) && opts.joins.length > 0) ||
  (Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0)
const countExpr = mayMultiplyBaseRows
  ? sql<string>`count(distinct ${sql.ref(`${table}.id`)})`
  : sql<string>`count(*)`
const countBuilder = hasJoinedAggregates
  ? qFull.clearSelect().clearOrderBy().clearGroupBy().select(countExpr.as('count'))
  : qFull.clearSelect().clearOrderBy().select(countExpr.as('count'))
const countRow = await countBuilder.executeTakeFirst()
const total = Number((countRow as any)?.count ?? 0)
```

`qFull` here carries the `custom_field_defs` / `custom_field_values` joins built at `:760-778`, the entity-extension joins at `:862-864`, the `array_agg(DISTINCT …)` / `bool_or(…)` projections at `:792-799`, and the `groupBy(base.id)` at `:888-890`. **None of that is needed to count.** The `DISTINCT` exists only to undo fan-out caused by joins the count does not require.

`HybridQueryEngine` has three further count sites: the optimized base-only path (`packages/core/src/modules/query_index/lib/engine.ts:848-882`), the full-shape path (`:883-897`), and custom-entity document storage (`:1756-1758`).

Measured on staging at ~1.4M orders, even a covering `(organization_id, tenant_id, status) WHERE deleted_at IS NULL` index still yields a parallel sequential scan for the non-selective case, because proving "N rows match" requires visiting N rows. A page of 50 sorted, filtered rows in ~300 ms is achievable; an exact filtered total in ~300 ms is not. Since list filters re-query per keystroke, the count dominates interactive latency.

Nothing in the repository currently short-circuits, caches, or bounds this. There is no `withTotal`, `skipCount`, or count option anywhere.

### Prior art

- **Issue #2227** (closed) optimized `count(distinct id)` → `count(*)` where no join can multiply base rows — visible in the comment at `engine.ts:908-911`. Its two other proposals, *cache the count* and *opt out of count*, went unimplemented. This spec completes the direction #2227 started: #2227 removed the `DISTINCT` where it was provably unnecessary; this spec removes the *joins that made it necessary*.
- **`.ai/specs/2026-05-24-crud-api-performance-quick-wins.md`** sets "<100 ms p50 for CRUD" as the goal and names `COUNT(*)` as a cost line (`:22`, `:36`), but gives it no phase, flag, or acceptance criterion. It explicitly scoped out (`:245-250`) replacing `BasicQueryEngine` or rewriting the query indexer, and its stated invariant is *"no response-shape change"* (`:59`). This spec is the part it scoped out, and it deliberately breaks that invariant in the smallest possible way.
- **`.ai/specs/SPEC-033-2026-02-18-omnibus-price-tracking.md:371-394`** already ships `includeTotal?: boolean` with verbatim this rationale — *"`total` is omitted by default because a `COUNT(*)` over a filtered time-range on a large history table is expensive"* — but on a new endpoint, so it incurred no backward-compatibility cost.

## Proposed Solution

### Why the obvious implementation does not work

The intuitive change is one line:

```ts
countBuilder = countBuilder.limit(cap + 1)   // ❌ no-op
```

This does nothing. `countBuilder` selects an aggregate, so it produces exactly one row; `LIMIT 10001` bounds that single output row, not the scan feeding it. The database still visits every matching row.

The next-most-obvious fix — wrap it in a subquery and limit the inner query — is also insufficient wherever the inner query carries a `GROUP BY` or `DISTINCT`, which is exactly the case the `DISTINCT` was added for. Applying `LIMIT` to `HybridQueryEngine`'s existing `sub` (`query_index/lib/engine.ts:871`) yields:

```sql
SELECT count(*) FROM (SELECT b.id FROM … GROUP BY b.id LIMIT 10001) sq
```

PostgreSQL plans this as `Limit → HashAggregate → Scan`. **`HashAggregate` is a blocking node**: it consumes its entire input before emitting the first row, so the `Limit` above it never cuts the scan short. The same applies to `GroupAggregate`, which is fed by a blocking `Sort`. Any aggregate or sort barrier between the `LIMIT` and the scan defeats the bound.

A bound is only enforceable when the limited query has **no barrier between the `LIMIT` and the table scan** — that is, a plain row-producing query.

### The count query is rebuilt, not derived

The count query stops being a mutation of the display query and becomes its own construction:

1. **Start from the base table with scope and filters only.** Base-scope predicates, regular filters, or-grouped filters.
2. **Omit every projection-only join.** Entity-extension joins (`engine.ts:862-864`) and custom-field *value* projections exist to populate response columns. A count never reads them. Dropping them removes the fan-out that forced `DISTINCT`.
3. **Express every filtering join as a correlated `EXISTS` semi-join.** A semi-join is defined to return each base row at most once, so it cannot multiply rows — which means no `DISTINCT`, no `GROUP BY`, and therefore no barrier.
4. **Select a constant, and apply `LIMIT cap + 1`.**
5. **Count the bounded rows in an outer aggregate.**

```sql
SELECT count(*) AS count FROM (
  SELECT 1
  FROM orders o
  WHERE o.tenant_id = $1
    AND o.organization_id = ANY($2)
    AND o.deleted_at IS NULL
    AND o.status = $3
    AND EXISTS (
      SELECT 1 FROM custom_field_values v
      WHERE v.record_id = o.id
        AND v.entity_id = $4
        AND v.field_key = $5
        AND v.value_text = $6
    )
  LIMIT 10001
) sq
```

The inner query plans as `Limit → Scan` (with the `EXISTS` as a semi-join or subplan). The `Limit` stops the scan after 10 001 qualifying rows regardless of how many exist. If the outer count returns `cap + 1`, report `total: cap` and set the capped flag; otherwise the count is exact and returns verbatim.

**This idiom already exists in the codebase.** The token-search path builds exactly this shape — `GROUP BY … HAVING count(distinct token_hash) >= n` confined inside a correlated `EXISTS` (`packages/shared/src/lib/query/engine.ts:1218-1227`, and the hybrid twins at `query_index/lib/engine.ts:1180` and `:1362`). That also settles the hardest case: a filter over a joined aggregate ("orders with more than 3 line items") stays cappable, because the aggregate is confined *inside* the subquery and evaluated per base row, leaving the outer `LIMIT` free to stream.

### Per-site treatment

| # | Site | Today | Rebuilt as |
|---|------|-------|------------|
| 1 | `shared/lib/query/engine.ts:912-923` — `BasicQueryEngine` | `count(*)` or `count(distinct base.id)` over `qFull` with CF + extension joins and `groupBy` | Base + scope + filters; CF filters → `EXISTS`; extension joins dropped; `LIMIT cap + 1` in an inner subquery |
| 2 | `query_index/lib/engine.ts:848-882` — hybrid optimized (`canOptimizeCount`, `:784`) | `count(*)` over `sub` with `groupBy(b.id)` (`:871`) | `groupBy` removed; `joinFilters` → `EXISTS`; `LIMIT cap + 1` on the inner row-producing query |
| 3 | `query_index/lib/engine.ts:883-897` — hybrid full shape | `count(distinct b.id)` over `applyQueryShape` (`:756-781`) incl. CF source joins and CF filters | CF source joins dropped; `applyCfFilters` → `EXISTS` form; `LIMIT cap + 1` |
| 4 | `query_index/lib/engine.ts:1756` — custom-entity document storage | `count(distinct alias.entity_id)` over `applyScope` (`:1648-1675`) | `applyCfFilterFromAlias` → `EXISTS`; `distinct` dropped; `LIMIT cap + 1` |

Site 2's `canOptimizeCount` gate (`!hasCustomFieldFilters && !hasNonBaseSearchSource`, `:784`) becomes largely redundant once CF filters are expressible as `EXISTS` in the count: the "optimized" and "full shape" count paths converge on the same construction. The gate is retained in Phase 2 to keep the diff reviewable, and removed as a follow-up only if the convergence proves total.

### What this buys with the cap disabled

The rebuilt count is **strictly cheaper than today's even when `OM_LIST_COUNT_CAP=0`**, because it drops the `custom_field_defs` join, the `custom_field_values` projection join, the extension joins, the `CASE` type-coercion expressions, the `array_agg`/`bool_or` aggregates, and the `GROUP BY` — from every count on every list request. That makes Phase 2 independently valuable and independently shippable, and it means the cap is a bound layered on an already-improved query rather than the only source of the win.

### Honest limitation

The cap bounds the count's *output*, not its *input*. A filter matching 3 rows out of 1.4M with no usable index still scans the table to prove only 3 match, because the `LIMIT` never fires. This spec fixes the non-selective case — the one measured as a parallel sequential scan — and indexing remains separate work.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Rebuild the count query rather than bound the existing one | A `LIMIT` above an aggregate is a no-op and a `LIMIT` above `GROUP BY` is blocked by `HashAggregate`. No bound is enforceable without removing the barrier, and the barrier only exists because the count inherits projection joins. |
| Filtering joins → `EXISTS`, projection joins → dropped | A semi-join cannot multiply base rows, which removes the reason `DISTINCT` was needed. The idiom is already used for token search at `engine.ts:1218-1227`. |
| Cap unconditionally at the engine; no mode enum, no per-call option | An `exact \| capped` enum implies two implementations. Once the six loop sites stop reading `total`, nothing needs an opt-out. `OM_LIST_COUNT_CAP=0` remains the operator-level escape hatch. |
| Report `total: cap`, not `cap + 1` | `cap` is the number the UI renders ("10 000+"). Reporting the probe value would leak an implementation detail into every consumer. |
| Add `totalIsCapped` rather than let clients infer | Inferring capping by comparing `total` against a cap the client does not know mislabels a genuine total of exactly `cap`. One boolean removes the guess. |
| Also emit `meta.listCountCapWarning` | `QueryResultMeta` (`types.ts:158-161`) is the established channel for "this result was bounded" signals and already carries `encryptedSortRowCapWarning`. The engine-internal detail belongs there; `totalIsCapped` is the documented public mirror, because `meta` is *not* part of `createPagedListResponseSchema` (`openapi/crud.ts:14-20`) and external clients need a schema'd signal. |
| `total` stays `number`, never null/absent | Keeps all four STABLE contract surfaces untouched and reduces the wire change to additive optional fields under `BACKWARD_COMPATIBILITY.md` §7. |
| Encrypted-sort truncation detected from the candidate scan, not from `total` | `total` may itself be capped, which would silently disable the existing warning. Probing the candidate scan with `limit(cap + 1)` is an exact, count-independent truncation test. |
| Convert loops to short-page termination rather than opting them out of the cap | Strictly better code independent of this spec: a count-terminated loop is already wrong when rows are inserted or deleted while it runs, and `customers/api/utils.ts:327` can already spin forever today. |
| Ship enabled by default, as an accepted minor breaking change | Opt-in does not spare large installations the problem, only the fix — they keep paying the unbounded count scan. The population that would have to find and set the flag is the population the feature is for. Nothing is lost above the cap once Phase 1 lands; only a label and page depth change. `UPGRADE_NOTES.md`, a breaking-change release note, and the permanent `OM_LIST_COUNT_CAP=0` escape hatch carry the communication burden instead. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| `countBuilder.limit(cap + 1)` on the existing builder | A no-op: `LIMIT` bounds the single aggregate output row, not the scan. This was the original proposal in this spec and is the reason it was revised. |
| Wrap the existing builder in a subquery, keeping `GROUP BY` | Still blocked: `HashAggregate` consumes its whole input before emitting, so the outer `LIMIT` cannot cut the scan. |
| `SELECT DISTINCT b.id … LIMIT cap + 1` | Depends on the planner choosing `Unique` over an index-ordered scan rather than a blocking `HashAggregate`/`Sort`. Plan-dependent and fragile; the `EXISTS` rewrite is deterministic. |
| `count` modes `exact \| capped \| none` per endpoint, overridable per request | Three code paths and a public query parameter, for an opt-out nothing needs after the loop conversions. `none` additionally omits `total`, prohibited by `BACKWARD_COMPATIBILITY.md` §7 without the full deprecation protocol. |
| `count: { cap: number \| null }` as a per-call option | An intermediate step that survived one design round. Unnecessary once the loop sites terminate on a short page, and it re-introduces a contract field callers must reason about. |
| Cache the count (per filter signature, tag-invalidated) | Issue #2227's unimplemented proposal. Does not help the interactive case at all — every keystroke is a fresh filter signature, so every keystroke is a cache miss and pays the full count. |
| Postgres `reltuples` estimate | Only valid for an unfiltered table and drifts with autovacuum timing. Wrong for the filtered case, which is the case that hurts. |
| Serve the unfiltered total from `entity_index_coverage.base_count` | Real but narrow: `base_count` is scope-level and filter-blind, so it serves only zero-filter queries. It is also delta-maintained and can drift, producing a wrong total with no visible error. Deferred, not rejected. |
| Keyset/cursor pagination instead | Solves page-depth, not counting — a keyset list still needs a total to render "of N". Substantially larger: `DataTable` has no cursor concept, and sorting spans encrypted columns, custom fields and joins. Deferred to its own spec. |

## Architecture

### Count path today

```
GET /api/<resource>
 └─ makeCrudRoute list handler, query-engine branch    factory.ts:1651
     └─ qe.query(entityId, queryOpts)                  factory.ts:1740
         ├─ HybridQueryEngine.query                    query_index/lib/engine.ts:176
         │   ├─ custom-entity doc storage → count(distinct entity_id)   :1756   ← cap site 4
         │   ├─ optimized  → count(*) over grouped-id subquery          :848    ← cap site 2
         │   ├─ full-shape → count(distinct b.id)                       :883    ← cap site 3
         │   └─ delegate → BasicQueryEngine (no-index / partial / omit-scope)
         └─ BasicQueryEngine.query                     shared/lib/query/engine.ts:233
             └─ count(*) | count(distinct base.id)     shared/.../engine.ts:912  ← cap site 1
     └─ payload { items, total, page, pageSize, totalPages, meta? }     factory.ts:1848-1855
```

`HybridQueryEngine` delegates to `BasicQueryEngine` for missing base tables, `omitAutomaticTenantOrgScope`, zero index rows, and partial index coverage — so site 1 is reachable in normal operation, not only in a basic-engine deployment.

### Cap resolution

A single module-level resolver in `packages/shared/src/lib/query/` reads `OM_LIST_COUNT_CAP` (default `10000`; `0` disables capping — see *Configuration*) and both engines consume it. It mirrors `resolveEncryptedSortMaxRows` (`packages/shared/src/lib/query/encrypted-sort.ts:32-38`) exactly, including returning a nullable number rather than a sentinel. No cap value travels through `QueryOptions`, request bodies, or the DI container.

### Encrypted-sort truncation, decoupled from `total`

Both engines currently decide whether to emit `encryptedSortRowCapWarning` by comparing against the count: `shared/engine.ts:995` and `query_index/lib/engine.ts:966`, both `if (cap !== null && total > cap)`. Once `total` can itself be capped, that comparison silently stops firing whenever `OM_ENCRYPTED_SORT_MAX_ROWS >= OM_LIST_COUNT_CAP` — the engine would return a sort over a truncated candidate set with no warning at all.

The fix does not involve `total`. The phase-1 candidate scan already applies `.limit(cap)` (`shared/engine.ts:981-984`, `query_index/lib/engine.ts:948-950`). Change it to `.limit(cap + 1)`, slice back to `cap` before sorting, and treat `candidateRows.length > cap` as the truncation test. That is exact, independent of any count, and is the same `cap + 1` probe used for the list count.

`EncryptedSortRowCapWarning.totalMatched` (`types.ts:151-156`) keeps its field name and type. Its documented meaning becomes: exact when `meta.listCountCapWarning` is absent, a floor when it is present.

### Short-page termination

The converted loops adopt one shape — collect until a page returns fewer rows than requested, with a hard page ceiling that **fails closed**:

```ts
const MAX_PAGES = 1000
let page = 1
for (;;) {
  const res = await qe.query(entityId, { ...queryBase, page: { page, pageSize } })
  const batch = res.items ?? []
  collect(batch)
  if (batch.length < pageSize) break
  if (page >= MAX_PAGES) {
    throw new Error(`[internal] result set exceeded ${MAX_PAGES} pages; refusing to return a partial set`)
  }
  page += 1
}
```

This terminates on the true end of the result set regardless of what `total` says, and — unlike the current form — is correct when rows are inserted or deleted mid-loop. `packages/core/src/modules/directory/components/TenantSelect.tsx:96-103` already implements this shape correctly (short-page break plus `page <= DIRECTORY_TENANTS_MAX_PAGES`) and is the in-repo reference.

The ceiling throwing rather than returning is deliberate and is covered under *Risks*: a partial export or a partial id set is precisely the silent-data-loss failure this spec exists to prevent.

### Commands & Events

None. This spec introduces no command and no event, and subscribes to none.

## Data Models

**No data-model change.** No entity is added, altered, or removed; no migration ships with this spec; `.snapshot-open-mercato.json` is untouched. The existing `entity_index_coverage.base_count` column is referenced only in *Alternatives* and is not read by this change.

## API Contracts

### `QueryResultMeta` — `packages/shared/src/lib/query/types.ts:158-161`

```ts
export type ListCountCapWarning = {
  entity: EntityId
  cap: number
}

export type QueryResultMeta = {
  partialIndexWarning?: PartialIndexWarning
  encryptedSortRowCapWarning?: EncryptedSortRowCapWarning
  listCountCapWarning?: ListCountCapWarning
}
```

Mirrors the existing `encryptedSortRowCapWarning` convention. Present only when the count was actually bounded.

### `QueryResult` — `packages/shared/src/lib/query/types.ts:163-177`

`QueryResult` is **unchanged**. The cap signal reaches consumers through the existing optional `meta` field, so no new top-level property is added to the engine contract.

### CRUD list payload — `packages/shared/src/lib/crud/factory.ts:1848-1855`

```ts
const payload = {
  items: transformedItems,
  total: res.total,
  page: page.page || requestedPage,
  pageSize: page.pageSize || requestedPageSize,
  totalPages: Math.ceil(res.total / (Number(page.pageSize) || 1)),
  ...(res.meta?.listCountCapWarning ? { totalIsCapped: true } : {}),
  ...(res.meta ? { meta: res.meta } : {}),
}
```

Emitted only when true, matching the existing `meta` spread convention. Every other field is unchanged. When capped, `totalPages` is `ceil(cap / pageSize)` — a bounded page count, documented below.

### OpenAPI — `packages/shared/src/lib/openapi/crud.ts:11-21`

`createPagedListResponseSchema` gains `totalIsCapped: z.boolean().optional()`. `total` stays `z.number()`. This schema has ~150 non-test call sites, so it is the single lever for the documented public contract.

### Direct-payload routes

Routes that call the QueryEngine directly and hand-build a list payload do not go through `makeCrudRoute` and must each forward the flag. Audited set:

| Route | Payload |
|-------|---------|
| `packages/core/src/modules/customers/api/deals/map/route.ts` | `:542-548` (engine resolved `:229`, queried `:405`) |
| `packages/core/src/modules/entities/api/records.ts` | `:348-354`; response schema `:168-174` |
| `packages/core/src/modules/attachments/api/library/route.ts` | `:156`, `:175` |
| `packages/core/src/modules/customers/api/todos/route.ts` | `:267`, `:306` |
| `packages/core/src/modules/customers/api/interactions/tasks/route.ts` | `:71`, `:111` |

A broader tail of list routes builds `total`/`totalPages` from `em.findAndCount` or a service rather than the QueryEngine (checkout links/templates/transactions, audit_logs, business_rules, data_sync, integrations, messages, notifications, progress, workflows, and others). **These are unaffected**: they never touch the capped code path, so their totals stay exact and they correctly omit `totalIsCapped`. They are listed here only to record that the audit covered them.

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

### There is no central propagation point

An audit of the client found that a shared type exists but is effectively dead, and that no shared hook centralizes list state:

- `ListResponse<T>` (`packages/ui/src/backend/utils/crud.ts:3-9`) has **zero importers** outside its own file. Its only producer, `fetchCrudList` (`:63-68`), has 3 product call sites plus 2 create-app template mirrors.
- There is **no** `useCrudList` / `useDataTableQuery` / `useListQuery` or equivalent anywhere in the repo. `packages/ui/src/backend/hooks/` contains one unrelated file.
- 65 `pagination={{ … }}` call sites across 64 files each parse the list response themselves, in four distinct patterns: `useState` + `setTotal`/`setTotalPages` (~40 files), inline TanStack `useQuery` derivation (~9), **client-side `totalPages` recomputation from a server `total`** (2), and fully client-side tables that derive both `total` and `totalPages` from a locally filtered array (6).

Adding the field to `ListResponse` therefore reaches nothing on its own. This is the honest cost of the change and it is why the UI work is phased rather than claimed as complete.

### Mechanism

`PaginationProps` (`packages/ui/src/backend/DataTable.tsx:115-125`) gains `totalIsCapped?: boolean`; every existing field keeps its current type and optionality, so all 65 call sites compile unchanged. `formatPageInfo` (`:2367-2371`) selects the capped i18n key when the flag is set. `DataTable.tsx:2318`'s `pagination.total === 0` early return is left as-is and stays correct, because `total` is always a real number under this design.

`packages/ui/src/primitives/pagination.tsx` derives `totalPages` itself from `total` at `:216` — it never receives one. Consequently the last-page jump (`:334-345`, target `goTo(totalPages)` at `:340`) would land on the last *capped* page while presenting itself as the end of the data. When capped, that button is suppressed; first/previous/next and the numbered buttons are unaffected and remain bounded by `ceil(cap / pageSize)`.

Two sites recompute `totalPages = Math.ceil(total / pageSize)` from a server-provided `total` (`inbox_ops/backend/inbox-ops/page.tsx:386`, `inbox_ops/backend/inbox-ops/log/page.tsx:222`); they already ignore the server's `totalPages` and would derive a bounded page count automatically, so they need no change for correctness, only for labelling. The two enterprise security pages (`security/users/page.tsx:73-74`, `security/enforcement/page.tsx:122-123`) look similar but are not affected at all: their `total` is `filteredItems.length` from a client-side filter and they slice locally, so they never read a server `total` or `totalPages`.

### Adoption

Because the cap is **on by default**, Phase 3 cannot stop at a highest-traffic subset: an unadopted table renders a floor as exact from the first upgraded release. Phase 3 therefore covers **every server-backed `DataTable` call site** — Patterns A (~40 files) and B (~9), which already plumb `total` and `totalPages` through local state or a `useQuery` derivation, so each is a mechanical three-line addition alongside fields that are already there. The two Pattern C sites need the flag for labelling only. Pattern D sites (fully client-side tables over a locally filtered array) never read a server total and are out of scope by construction.

This is the largest single cost of defaulting the cap on, and it is deliberately paid here rather than deferred into a residual risk. The absence of a shared list hook is what makes it ~49 edits instead of one; introducing that hook is worth doing, but it is a separate refactor and is not a prerequisite.

One non-pagination consumer needs the same treatment: `ProductsDataTable.tsx:707-712` passes `total` into `injectionContext` as `totalMatching`, where the merchandising AI widget reads it as a truthful match count.

No new component, no layout change, no new colour or spacing token.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `OM_LIST_COUNT_CAP` | `10000` | Maximum reported list total. `0` disables capping entirely, restoring exact counts globally. |

**The cap is on by default from the introducing release.** Making it opt-in does not spare existing installations the consequences of the change — it spares them only the *fix*. An installation large enough for a capped total to be visible is, by definition, one already paying an unbounded count scan on every filtered list request; leaving the cap off leaves those clients timing out. The population that would have to discover and set the flag is exactly the population the feature exists for. Shipping it off would leave the status quo — materially Odoo's `search_count()`-per-list-view design — in place indefinitely.

The change is invisible to any list whose filtered result set never reaches 10 000 rows, which is the overwhelming majority of lists in the overwhelming majority of installations. Above that it is a label and a page-depth change, not a data change: every path that consumed `total` as ground truth about the full result set is converted in Phase 1 and is correct regardless of the cap. `OM_LIST_COUNT_CAP=0` restores exact counts globally, is a permanently supported configuration, and takes effect without an application redeploy.

Mirrored into `apps/mercato/.env.example` and the create-app template per the Template Sync Checklist. Surfaced in `packages/core/src/modules/configs/lib/system-status.ts` alongside the existing `OPTIMIZE_INDEX_COVERAGE_STATS` knob so operators can see the effective value.

## Migration & Backward Compatibility

**No database migration.** No entity, column, or index changes.

**Contract classification** under `BACKWARD_COMPATIBILITY.md`:

| Surface | Change | Classification |
|---------|--------|----------------|
| `QueryResultMeta` (§2 Type Definitions) | Add optional `listCountCapWarning` | **Additive — permitted.** Mirrors `encryptedSortRowCapWarning`. |
| `QueryResult` (§2) | Unchanged | — |
| CRUD list response (§7 API Routes) | Add optional `totalIsCapped` | **Additive — permitted.** *"MAY add new optional fields to request/response schemas."* No field removed. |
| `PaginationProps` (§3 Function Signatures) | Add optional `totalIsCapped` | **Additive — permitted.** *"MUST NOT remove existing props"* — none removed. |
| `QueryEngine.query` signature | Unchanged | — |
| Request schemas | Unchanged | — |

**The behavioural change** is that `total` becomes a floor, and `totalPages` a bounded page count, for result sets above the cap. `BACKWARD_COMPATIBILITY.md` classifies *fields*, not *values*, so no field-level contract is broken — but a value-level change to a STABLE response is still a change existing clients did not ask for, and third-party clients of `makeCrudRoute` cannot be audited from this repository. The six internal loops converted in Phase 1 are direct evidence that consumers do treat `total` as exact.

**This is accepted as a minor breaking change, taken deliberately rather than deferred.** The cap ships enabled (`OM_LIST_COUNT_CAP=10000`) in the introducing release. The reasoning:

- **Nothing is lost, only bounded.** Every internal consumer that treated `total` as ground truth about the full result set is converted in Phase 1 and is correct whatever the cap says. What remains above the cap is a displayed label ("10 000+" instead of "14 302") and a bounded page depth. No export truncates, no filter omits matches, no delete acts on a subset.
- **It is invisible below the cap.** Any list whose filtered result set never reaches 10 000 rows behaves byte-identically — which is most lists in most installations. Confirmed against the existing suites: no current test asserts a `total` anywhere near 10 000 (largest exact assertions are `317`, `137`, `120`).
- **The alternative is that nobody gets the fix.** A default-off performance flag is discovered by the operators who read release notes, not by the ones drowning in a 1.4M-row table. Deferring the default is deferring the feature.
- **It is reversible in seconds, without a deploy.** `OM_LIST_COUNT_CAP=0` restores exact counts globally and remains permanently supported — not a deprecation shim.

Communication requirements, which are not optional even though the default is:

1. `UPGRADE_NOTES.md` documents the cap, the `totalIsCapped` field, the "treat `total` as a floor when `totalIsCapped` is true" rule for client authors, and the `OM_LIST_COUNT_CAP=0` escape hatch.
2. Release notes call the behaviour change out explicitly, under a breaking-change heading, rather than burying it in a performance bullet.
3. Because the default is on from day one, **Phase 3 must reach every server-backed `DataTable` call site**, not a highest-traffic subset — otherwise unadopted tables render a floor as exact on upgrade. See *UI/UX → Adoption*.

**Deployment**: no downtime, no backfill, no ordering constraint against other deploys. Phase 1 is independently correct and must land before the cap; Phase 2's query rebuild is independently beneficial and can be verified against exact-count parity before Phase 3 lands.

## Implementation Plan

### Phase 1 — Short-page termination *(independently correct; no cap yet)* — **Implemented 2026-08-04**

1. Convert the CRUD export loop, `packages/shared/src/lib/crud/factory.ts:1787-1807` (`while (exportItems.length < total)` at `:1792`), to short-page termination with a fail-closed page ceiling.
2. Convert the custom-entity records export loop, `packages/core/src/modules/entities/api/records.ts:357-371` (`while (exportItems.length < total)` at `:360`), identically.
3. Convert `findMatchingEntityIdsWithQueryEngine`, `packages/core/src/modules/customers/api/utils.ts:286-329` (`} while (ids.size < total)` at `:327`). **This also fixes a latent infinite loop that exists today**: `ids` is a `Set`, so duplicate ids across pages keep `ids.size` permanently below `total` and the only escape is an empty page. Callers: `customers/api/deals/route.ts:421`, `people/route.ts:318`, `companies/route.ts:326`.
4. Convert `fetchFilteredProductIds`, `packages/core/src/modules/catalog/widgets/injection/product-bulk-delete/widget.ts:105-125` (`while (page <= totalPages)` at `:111`, which today has **no** empty-page break and **no** page ceiling).
5. Convert `loadLegacyActivities`, `packages/core/src/modules/customers/components/detail/MiniWeekCalendar.tsx:137-186` (`} while (page <= totalPages)` at `:186`, no page ceiling).
6. Review `packages/core/src/modules/customers/utils/phoneDuplicates.ts:22-50` — terminates on `total` at `:48-50` but is already hard-bounded by `MAX_PAGES` at `:22`. Convert for consistency; not a hazard.
7. Regression tests asserting each converted loop enumerates the full result set when `total` deliberately under-reports, terminates on a short final page, and **throws rather than truncating** at the page ceiling.

`packages/core/src/modules/directory/components/TenantSelect.tsx:96-103` already implements the target shape and needs no change; use it as the reference in review.

### Phase 2 — Rebuild the count query, then bound it

1. Add the `OM_LIST_COUNT_CAP` resolver in `packages/shared/src/lib/query/`, mirroring `encrypted-sort.ts:32-38`.
2. Extract a shared "filter predicates as `EXISTS`" helper so all four sites construct semi-joins identically, following the existing token-search shape at `shared/engine.ts:1218-1227`.
3. Rebuild count site 1, `shared/lib/query/engine.ts:912-923`: drop extension and CF projection joins, CF filters → `EXISTS`, inner `LIMIT cap + 1`, outer `count(*)`.
4. Rebuild count sites 2 and 3, `query_index/lib/engine.ts:848-882` and `:883-897`: remove `groupBy(b.id)` at `:871`, `joinFilters` and CF filters → `EXISTS`, inner `LIMIT cap + 1`.
5. Rebuild count site 4, `query_index/lib/engine.ts:1756`: `applyCfFilterFromAlias` → `EXISTS`, drop `distinct`, inner `LIMIT cap + 1`.
6. Derive `meta.listCountCapWarning` when the bounded count returns `cap + 1`; report `total: cap`.
7. Decouple encrypted-sort truncation from `total`: probe the candidate scan with `limit(cap + 1)` at `shared/engine.ts:981-984` and `query_index/lib/engine.ts:948-950`, slice to `cap`, and test `candidateRows.length > cap` at `shared/engine.ts:995` and `query_index/lib/engine.ts:966`.
8. Add `totalIsCapped` to the factory payload (`factory.ts:1848-1855`), the custom-entity payload (`records.ts:348-354`), the four other direct-payload routes listed in *API Contracts*, and `createPagedListResponseSchema` (`openapi/crud.ts:11-21`).
9. Verify the list response cache (`factory.ts:1464-1525`) round-trips both the new field and `meta.listCountCapWarning`.

### Phase 3 — UI

1. `PaginationProps.totalIsCapped` and capped-key selection in `formatPageInfo` (`DataTable.tsx:115-125`, `:2367-2371`).
2. Suppress the last-page jump when capped (`pagination.tsx:334-345`).
3. Add `totalIsCapped` to `ListResponse` (`packages/ui/src/backend/utils/crud.ts:3-9`) so its `fetchCrudList` consumers get it for free.
4. Add the two i18n keys across all eight locale files; run `yarn i18n:check-sync`.
5. Adopt the flag at **every** server-backed `DataTable` call site — all ~40 Pattern A files (`useState` + `setTotal`/`setTotalPages`) and ~9 Pattern B files (inline `useQuery` derivation), plus the two Pattern C sites for labelling. Reference edits: catalog products (`ProductsDataTable.tsx:83-87`, `:597-598`, `:714-721`) and customers people (`people/page.tsx:121-126`, `:434-435`, `:991`); the rest follow the same three-line shape. Add a grep- or lint-based check that no `pagination={{` site backed by a `makeCrudRoute` list omits `totalIsCapped`.
6. Pass the flag alongside `totalMatching` in `ProductsDataTable.tsx:707-712` so the merchandising widget stops treating a floor as a match count.

### Phase 4 — AI tool packs

1. Surface `totalIsCapped` in the `mapResponse` of the affected `defineApiBackedAiTool` packs (customers `companies`/`deals`/`people`, catalog `products`/`variants`/`configuration`/`prices-offers`/`merchandising`).
2. Update the two prompt sites that document a `total`-based pagination rule to a short-page rule, so a capped total cannot stop the model paginating early:
   - `packages/core/src/modules/catalog/ai-tools/merchandising-pack.ts:100` (the `limit` field description) and `:269` (the tool description)
   - `packages/core/src/modules/catalog/ai-agents.ts:410`

   An audit of every other `ai-tools/*-pack.ts` under `packages/core/src/modules/{catalog,customers}` and `packages/ai-assistant` confirmed no sibling pack documents this rule; they use bare `offset` descriptions with no `total`-based guidance.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/query/types.ts` | Modify | `ListCountCapWarning`; `QueryResultMeta` field |
| `packages/shared/src/lib/query/engine.ts` | Modify | Cap resolver; count site 1 rebuild; encrypted-sort probe |
| `packages/shared/src/lib/query/encrypted-sort.ts` | Modify | Candidate-scan `cap + 1` probe helper |
| `packages/core/src/modules/query_index/lib/engine.ts` | Modify | Count sites 2–4 rebuild; encrypted-sort probe |
| `packages/shared/src/lib/crud/factory.ts` | Modify | Export loop; payload field |
| `packages/shared/src/lib/openapi/crud.ts` | Modify | Optional schema field |
| `packages/core/src/modules/entities/api/records.ts` | Modify | Export loop; payload field; response schema |
| `packages/core/src/modules/customers/api/utils.ts` | Modify | Id-resolution loop (+ latent infinite-loop fix) |
| `packages/core/src/modules/customers/api/deals/map/route.ts` | Modify | Direct payload field |
| `packages/core/src/modules/attachments/api/library/route.ts` | Modify | Direct payload field |
| `packages/core/src/modules/customers/api/todos/route.ts` | Modify | Direct payload field |
| `packages/core/src/modules/customers/api/interactions/tasks/route.ts` | Modify | Direct payload field |
| `packages/core/src/modules/catalog/widgets/injection/product-bulk-delete/widget.ts` | Modify | Filtered-ids loop |
| `packages/core/src/modules/customers/components/detail/MiniWeekCalendar.tsx` | Modify | Legacy-activities loop |
| `packages/core/src/modules/customers/utils/phoneDuplicates.ts` | Modify | Loop consistency |
| `packages/ui/src/backend/utils/crud.ts` | Modify | `ListResponse.totalIsCapped` |
| `packages/ui/src/backend/DataTable.tsx` | Modify | Prop + capped label |
| `packages/ui/src/primitives/pagination.tsx` | Modify | Suppress last-page jump |
| `packages/core/src/modules/catalog/components/products/ProductsDataTable.tsx` | Modify | Adoption + `totalMatching` |
| `packages/core/src/modules/customers/backend/customers/people/page.tsx` | Modify | Adoption |
| `packages/core/src/modules/catalog/ai-tools/merchandising-pack.ts` | Modify | Pagination rule |
| `packages/core/src/modules/catalog/ai-agents.ts` | Modify | Pagination rule |
| `apps/mercato/src/i18n/{en,pl,de,es}.json` | Modify | Two keys each |
| `packages/create-app/template/src/i18n/{en,pl,de,es}.json` | Modify | Template sync |
| `apps/mercato/.env.example` + template | Modify | `OM_LIST_COUNT_CAP` |
| `UPGRADE_NOTES.md` | Modify | Behaviour window + client guidance |

### Testing Strategy

**Compiled-SQL assertions are mandatory and are the only guard that catches the original no-op.** A mocked total would pass against a `LIMIT` that bounds nothing.

- **Unit — count SQL shape.** Extend `packages/shared/src/lib/query/__tests__/engine.count-distinct.test.ts` (the #2227 count test) and `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts`, asserting on `builder.compile().sql` that for each of the four sites: the `LIMIT cap + 1` sits on a **row-producing inner query**, no `GROUP BY` or `DISTINCT` appears between that `LIMIT` and the base table, CF/join filters are rendered as `EXISTS (…)`, and projection joins are absent.
- **Unit — cap boundary.** `cap - 1` and `cap` matching rows → exact total, no flag, no `meta.listCountCapWarning`. `cap + 1` → `total: cap`, `totalIsCapped: true`, warning present. `OM_LIST_COUNT_CAP=0` → today's behaviour on every path, including the basic-engine delegation paths.
- **Unit — count parity with the cap disabled.** The rebuilt count returns the same total as the current implementation across the CF-filter, extension-join, explicit-join and or-group filter matrices. This is the regression guard for the query rebuild itself, independent of capping.
- **Unit — encrypted-sort decoupling.** With `OM_ENCRYPTED_SORT_MAX_ROWS = OM_LIST_COUNT_CAP = N` and `2N` matching rows, `encryptedSortRowCapWarning` **must still fire**. This is the regression guard for the interaction that motivated the change.
- **Unit — loop conversion.** Each of the six converted loops enumerates the full result set when `total` deliberately under-reports, terminates on a short final page, and **throws** at the page ceiling rather than returning a partial result.
- **Unit — payload.** `totalIsCapped` absent when false, present when true; `total`, `page`, `pageSize`, `totalPages` byte-identical to today with the cap disabled.
- **Plan-level guard (targeted).** One `EXPLAIN`-backed test on a seeded table larger than a small test cap, asserting the plan contains no blocking aggregate between the `Limit` and the scan. This is the only test that fails if a future refactor reintroduces a barrier; keep it to a single case to limit brittleness.
- **Integration.** Per `.ai/qa/AGENTS.md:19`, executable specs go in the owning modules' `__integration__` folders, **not** `.ai/qa/tests` (which is reserved for shared Playwright config). Coverage, each with self-created and cleaned-up fixtures:
  - generic `makeCrudRoute` list above the cap → `totalIsCapped: true`, bounded `totalPages`
  - CSV/XLSX export of the same filter → contains **every** row, not `cap` rows
  - custom-entity records list and export → same two assertions
  - the three advanced-filter routes (`customers/api/{deals,people,companies}`) → full match set, not `cap`
  - catalog filtered bulk delete → acts on the full filtered set
  - `DataTable` capped navigation and labelling → "N+" rendered, last-page jump absent
  - AI/MCP tool response → `totalIsCapped` surfaced; short-page pagination rule honoured
- **Existing suites** must pass unchanged **with the default cap active**, not merely with capping off: no current test asserts a `total` anywhere near 10 000 (largest exact assertions are `317`, `137`, `120`, all mock-backed), so the `10000` default does not perturb them. This is the evidence for the "invisible below the cap" claim in *Migration & Backward Compatibility* and must be re-checked if any suite later seeds a larger fixture.

## Risks & Impact Review

#### Bound that does not bind
- **Scenario**: The cap is implemented as a `LIMIT` on the existing count builder, or on a subquery that retains `GROUP BY`/`DISTINCT`. The SQL looks correct, tests pass against mocked totals, and the query still scans every matching row — the feature ships with zero performance benefit and a behaviour change for nothing.
- **Severity**: **Critical** — this was the original design in this spec, caught in review.
- **Affected area**: All four count sites.
- **Mitigation**: The count query is rebuilt rather than bounded (*Proposed Solution*); compiled-SQL assertions on all four sites are mandatory; one `EXPLAIN`-backed plan test guards against later reintroduction of a barrier.
- **Residual risk**: A future refactor reintroduces a projection join into the count path. The plan-level test is the guard; it is deliberately kept to a single case to stay maintainable.

#### Count rebuild changing a total
- **Scenario**: The rebuilt count query is not semantically equivalent to the derived one — an `EXISTS` rewrite drops a scope predicate on the joined side, or a dropped projection join was silently acting as an inner-join filter — and totals change even with capping switched off.
- **Severity**: **High** — a wrong count with no visible signal, affecting every list.
- **Affected area**: All four count sites.
- **Mitigation**: Parity unit tests across the CF-filter, extension-join, explicit-join and or-group matrices assert identical totals before and after with `OM_LIST_COUNT_CAP=0`; compiled-SQL assertions verify joined-side scope predicates survive the `EXISTS` rewrite. Only `leftJoin`s are dropped, and only where no filter references the joined alias.
- **Residual risk**: A join shape not represented in the test matrix. Bounded by the cap shipping disabled, so the rebuild soaks in production on exact-count semantics before any capping is enabled.

#### Export truncation from a count-bounded loop
- **Scenario**: The cap ships without the Phase 1 conversion. `factory.ts:1792` bounds its export loop with `while (exportItems.length < total)`, so a CSV/XLSX export of any filter matching more than the cap stops at exactly `cap` rows and returns HTTP 200 with no warning.
- **Severity**: **Critical** — silent, plausible-looking data loss in a feature users rely on for reporting and migration.
- **Affected area**: Every `makeCrudRoute` list export in the product, plus custom-entity record export (`records.ts:360`).
- **Mitigation**: Phase 1 lands first and is independently correct; the cap in Phase 2 cannot regress it. Regression tests assert full enumeration when `total` under-reports.
- **Residual risk**: A future loop written against `total` reintroduces it. Partly addressed by the `listCountCapWarning` JSDoc stating `total` is a floor.

#### Advanced-filter result truncation
- **Scenario**: `findMatchingEntityIdsWithQueryEngine` (`customers/api/utils.ts:327`) pages with `do … while (ids.size < total)` and feeds the collected ids to `applyEntityIdRestriction`. Under a cap the id set stops at `cap`, so advanced-filtered deals/people/companies lists silently omit every matching record beyond it — and the list's own reported total is then wrong for a second, compounding reason.
- **Severity**: **Critical** — wrong query results presented as complete, in the customers module.
- **Affected area**: `customers/api/{deals,people,companies}/route.ts` advanced filters.
- **Mitigation**: Phase 1 step 3; regression test with a deliberately under-reported total.
- **Residual risk**: None identified once converted; the short-page form has no dependence on count.

#### Filtered bulk delete acting on a subset
- **Scenario**: `fetchFilteredProductIds` (`product-bulk-delete/widget.ts:111`) pages via server-derived `totalPages`. Capped, "delete all filtered" collects `cap` ids, shows the user "Delete {count} products matching the current filters?" with that number, and deletes only those — while the user believes the filter was fully applied.
- **Severity**: **High** — destructive operation on an incomplete set, though it under-deletes rather than over-deletes, so nothing is destroyed that the user did not select by filter.
- **Affected area**: Catalog product bulk delete.
- **Mitigation**: Phase 1 step 4.
- **Residual risk**: None once converted.

#### Encrypted-sort truncation warning silently disabled
- **Scenario**: Both engines gate `encryptedSortRowCapWarning` on `total > resolveEncryptedSortMaxRows()` (`shared/engine.ts:995`, `query_index/lib/engine.ts:966`). If `OM_ENCRYPTED_SORT_MAX_ROWS >= OM_LIST_COUNT_CAP`, a capped `total` can never exceed the encrypted-sort cap, the comparison is permanently false, and the engine returns a sort computed over a truncated candidate set with no warning at all.
- **Severity**: **High** — wrong ordering presented as complete, on encrypted-column sorts, with the existing safety signal removed. Gated behind `OM_ENCRYPTED_SORT_MAX_ROWS` being set (it defaults to `null`, `encrypted-sort.ts:32-38`), so it affects configured installations only.
- **Affected area**: Encrypted-column sorting in both engines.
- **Mitigation**: Phase 2 step 7 replaces the count comparison with a `cap + 1` probe on the candidate scan itself, making truncation detection exact and independent of any total.
- **Residual risk**: None — the probe cannot be affected by the list count.

#### Partial data returned at the iteration ceiling
- **Scenario**: A converted loop's termination depends on a page returning fewer rows than requested. A backend mis-reporting `pageSize`, or an engine path clamping the page size below the requested value, returns full pages indefinitely until the ceiling is hit.
- **Severity**: **Medium** — a failed request, by design.
- **Affected area**: The six converted loops.
- **Mitigation**: The ceiling **throws**; it does not return what it has collected. Returning a partial export, or passing a partial id set into advanced filtering or bulk delete, would recreate the Critical cases above, so the loops fail closed and the caller surfaces an error rather than serializing or mutating. Ceiling-exhaustion tests cover all six.
- **Residual risk**: A legitimate result set larger than `MAX_PAGES × pageSize` becomes an error rather than a slow success. Accepted: at 1000 pages × 100 rows that is 100 000 records in one synchronous request, which is a job, not a request.

#### Capped totals rendered as exact in unadopted tables
- **Scenario**: There is no shared client pagination helper (`ListResponse` has zero importers; no `useCrudList` exists), so 65 `pagination={{ … }}` call sites parse the response individually. Any site Phase 3 misses renders "10 000" with no "+" — and because the cap is on by default, that is visible on the first upgraded release rather than only to opt-in operators.
- **Severity**: **Medium** — a wrong label, not wrong data. Also affects `ProductsDataTable.tsx:707-712`, which passes `total` as `totalMatching` into the merchandising AI widget's injection context.
- **Affected area**: Any server-backed `DataTable` pagination call site not covered by Phase 3.
- **Mitigation**: Defaulting the cap on converts this from an accepted residual into a Phase 3 completion requirement: Phase 3 covers **every** Pattern A and Pattern B call site (~49), plus the two Pattern C sites for labelling and the `totalMatching` leak. Each is a mechanical addition next to `total`/`totalPages` plumbing that already exists. A lint or grep-based check that every `pagination={{` site backed by a `makeCrudRoute` list forwards `totalIsCapped` is the cheapest way to keep the set closed.
- **Residual risk**: A site added after Phase 3 forgets the flag. Bounded to labelling; a follow-up introducing the shared list hook whose absence causes this would make adoption a one-line change and close the gap structurally.

#### AI agents mis-stating counts and stopping pagination early
- **Scenario**: ~12 `defineApiBackedAiTool` packs lift `total` into `mapResponse` and advertise it. `merchandising-pack.ts:100`, `:269` and `catalog/ai-agents.ts:410` instruct the model to paginate *"when `total` exceeds `limit + offset`"* — under a cap the model stops after `cap` records and reports "10 000 products" as fact.
- **Severity**: **Medium** — wrong information to the model and to the user, but no data mutation; these are read paths.
- **Affected area**: Catalog AI tool packs and agent prompts, and the same tools exposed over MCP.
- **Mitigation**: Phase 4 surfaces `totalIsCapped` and replaces the documented pagination rule with a short-page rule.
- **Residual risk**: Prompt-level guidance is advisory; a model may still narrate a capped total as exact. Bounded by these being read-only tools.

#### Counts becoming approximate for existing installations
- **Scenario**: An operator upgrades, and lists that previously showed "14 302 results" now show "10 000+". Reports or screenshots built on those figures change. External API clients of `makeCrudRoute` — which cannot be audited from this repository — may treat `total` as exact.
- **Severity**: **Medium** — a value-level change to a STABLE response surface, shipped on by default. Deliberate, not incidental: this is the feature, and it is declared a minor breaking change rather than smuggled in behind a flag.
- **Affected area**: Deals map located-count, entity-link search results, pipeline lane totals, company people badge, webhooks setup widget, and every `DataTable` footer above the cap.
- **Mitigation**: `UPGRADE_NOTES.md` documents the cap, the floor semantics of `total`, the `totalIsCapped` field and the escape hatch; release notes carry it under a breaking-change heading rather than a performance bullet. `OM_LIST_COUNT_CAP=0` restores exact counts globally, takes effect without an application redeploy, and is permanently supported. Nothing below 10 000 rows changes at all, so the blast radius is limited to installations large enough to already be suffering the unbounded scan.
- **Residual risk**: Accepted. An external client that reads `total` as exact and ignores `totalIsCapped` will under-report above the cap; this cannot be detected from this repository, which is why the release-note treatment is a requirement rather than a courtesy.

#### Cap does not help selective filters without an index
- **Scenario**: A filter matching 3 rows out of 1.4M with no usable index still scans the table to prove only 3 match. The cap bounds the count's output, not its input, so this case is unimproved by the `LIMIT` — though it does benefit from the lighter rebuilt count query.
- **Severity**: **Low** — no regression, only an unmet expectation.
- **Affected area**: Narrow filters on large tables lacking a supporting index.
- **Mitigation**: Stated explicitly here and in the PR so the change is not oversold; indexing remains separate work.
- **Residual risk**: Accepted and documented.

### Tenant & Data Isolation

No new shared or global state: the cap is a read-only process-level constant, and no counter, cache entry, or queue is introduced. All existing tenant/organization scoping is applied before the cap — the rebuilt count query starts from `applyBaseScope` exactly as today, and the `LIMIT` sits above the fully scoped predicate set, so it cannot widen a scope. The `EXISTS` rewrite preserves every scope predicate on the joined side (`custom_field_values.tenant_id`, alias organization scopes) verbatim; compiled-SQL tests assert their presence. Noisy-neighbour impact is *reduced*: a tenant with millions of rows can no longer force an unbounded count scan on shared database capacity.

### Cascading Failures & Side Effects

No events are emitted or subscribed. No module gains a dependency on another. The list response cache (`factory.ts:1464-1525`) stores the payload verbatim, so a cached capped payload replays consistently; entries written before the upgrade simply lack `totalIsCapped` and are read as exact, which is correct for the values they hold. The count-query rebuild changes SQL shape but not results below the cap — equality with today's totals under `OM_LIST_COUNT_CAP=0` is asserted by the parity tests across all four sites.

### Operational

Blast radius is bounded to list reads and the six converted loops. The failure mode most worth watching is an export or advanced filter returning fewer rows than expected — covered by the Phase 1 regression tests, and reversible in production by setting `OM_LIST_COUNT_CAP=0` without a redeploy of application code. The second is a count-query rebuild that changes a total independently of capping, which the `OM_LIST_COUNT_CAP=0` parity tests are designed to catch pre-merge. No storage growth, no new rate-limiting surface.

## Final Compliance Report — 2026-07-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `CONTRIBUTING.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No entity or relation added |
| root AGENTS.md | Filter by `organization_id`; never expose cross-tenant data | Compliant | Cap is a `LIMIT` above the fully scoped predicate set; `EXISTS` rewrite preserves joined-side scope predicates, asserted by compiled-SQL tests |
| root AGENTS.md | Never edit generated files by hand | Compliant | No generated file touched |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | Two new i18n keys across all eight locale files; the loop-ceiling throw is `[internal]`-prefixed per the i18n opt-out convention |
| root AGENTS.md | No `any` types | Compliant | `totalIsCapped` is `boolean \| undefined`; `ListCountCapWarning` is a named type |
| root AGENTS.md | Optimistic locking for new user-editable entities | N/A | No entity introduced |
| root AGENTS.md | Run `yarn generate` after auto-discovery changes | N/A | No module file added or moved |
| root AGENTS.md | Create-app Template Sync Checklist for `.env.example` / app changes | Compliant | `OM_LIST_COUNT_CAP` and both i18n keys mirrored into the template |
| BACKWARD_COMPATIBILITY.md §2 | Optional fields may be added freely; required fields MUST NOT be removed or narrowed | Compliant | `total` unchanged; `totalIsCapped` and `listCountCapWarning` optional |
| BACKWARD_COMPATIBILITY.md §7 | MUST NOT remove fields from existing response schemas | Compliant | Nothing removed; one optional field added |
| BACKWARD_COMPATIBILITY.md §3 | `DataTable` props MUST NOT be removed | Compliant | Additive optional prop only |
| BACKWARD_COMPATIBILITY.md rule 5 | Contract-surface PRs MUST reference a spec with a Migration & Backward Compatibility section | Compliant | Present above. Field-level: fully additive. Value-level: declared a minor breaking change, shipped on by default, with `UPGRADE_NOTES.md`, a breaking-change release note and a permanent escape hatch |
| packages/ui/AGENTS.md | Use DS tokens; no arbitrary values or hardcoded status colours | Compliant | No new styling; label text only |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | No new route; shared schema updated additively |
| .ai/specs/AGENTS.md | Required sections present; risks document scenario/severity/area/mitigation/residual | Compliant | Ten risks in the required format |
| .ai/specs/AGENTS.md | No new `SPEC-*` filename prefix | Compliant | `2026-07-27-list-count-strategies.md` |
| .ai/qa/AGENTS.md | Executable specs live in module `__integration__` folders, never `.ai/qa/tests` | Compliant | Testing Strategy places all integration coverage in owning modules with self-created, cleaned-up fixtures |
| CONTRIBUTING.md | Spec registered in `.ai/specs/README.md` with a dated changelog | Compliant | Row added to the Pending table; changelog below |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data model; API adds one optional field plus one optional `meta` warning |
| API contracts match UI/UX section | Pass | `totalIsCapped` produced by the engine via `meta`, forwarded by the factory and the five direct-payload routes, consumed by `DataTable` |
| Risks cover all write operations | Pass | The only write-adjacent path is filtered bulk delete, covered as its own risk |
| Commands defined for all mutations | N/A | No mutation introduced |
| Cache strategy covers all read APIs | Pass | Existing list cache round-trips the new field; Phase 2 step 9 verifies |
| Every cited file:line verified against the tree | Pass | All ~90 references audited line-by-line at `ba2cd5d` during the review revision; six materially wrong anchors and five off-by-N ranges were corrected, and two claims the audit contradicted (the enterprise-security pages, `merchandising-pack.ts:101`) were rewritten rather than re-cited |

### Non-Compliant Items

None blocking. One deferred item: integration tests are specified but not shipped, because this contribution is the specification only — noted in the matrix and in the PR description.

### Verdict

**Fully compliant** — ready for implementation.

## Changelog

### 2026-08-12 — Phase 2 implemented ([#5228](https://github.com/open-mercato/open-mercato/pull/5228))

The count query is rebuilt at all four sites rather than bounded: scope + filters only, cf/doc filters as correlated `EXISTS` semi-joins, projection joins dropped, `SELECT 1 … LIMIT cap + 1` inner and `count(*)` outer — so the `LIMIT` stops the scan instead of being absorbed by a blocking `HashAggregate`. Sites as implemented:

- `BasicQueryEngine` — `packages/shared/src/lib/query/engine.ts`; extension and CF projection joins dropped from the count, CF filters compiled to `EXISTS`.
- Hybrid optimized path and full-shape path — `packages/core/src/modules/query_index/lib/engine.ts`; the `groupBy(b.id)` is gone, and rowset-dependent predicates evaluate inside one seed-rowed `EXISTS` built from the display query's own join builders, so per-base-row filter semantics are identical by construction.
- Custom-entity doc storage — same file; `applyCfFilterFromAlias` compiled to `EXISTS`, `distinct` dropped.

`resolveListCountCap()` lives in `packages/shared/src/lib/query/count-cap.ts` (default `10000`, `0` = permanent kill switch, no entity parameter). `QueryResult` shape is unchanged; the cap surfaces as `meta.listCountCapWarning` from the engine and `totalIsCapped: true` spread onto CRUD payloads (`crud/factory.ts`, `openapi/crud.ts`).

Decoupled and adjacent work folded in: encrypted-sort truncation now runs its own `cap + 1` probe instead of reading the cappable `total`; the WMS `inventoryMutationLoaders.ts` loops flagged by Phase 1 terminate on a short page rather than on `totalPages`.

**Audit deltas against this spec's `ba2cd5d` line audit.** Three of the five listed direct-payload routes had drifted: attachments, todos and interactions/tasks now derive totals from `em.findAndCount` or in-memory pagination, which the cap never touches, so they were left unchanged — as were the workflows and dictionaries `hasMore` fields. Only `customers/api/deals/map` and `entities/api/records` still consume engine totals and carry the flag.

Test coverage per the mandated plan: compiled-SQL shape assertions per site (`EXISTS` rendering, no `GROUP BY`/`DISTINCT` beneath the probe `LIMIT`, projection joins absent), cap boundary (cap−1/cap/cap+1/0/unparseable), a count-parity matrix at `cap=0` against both ground truth and the display query's own rowset, an encrypted-sort regression, and the `EXPLAIN`-backed plan guard against a live PostgreSQL 16 (gated on `OM_COUNT_CAP_PG_URL`) asserting `Limit → scan` with no blocking node below the `Limit`.

`cf:` clauses inside `$or` (proper OR-group support landed on `develop` via #5039/#5056 while this phase was in review): the count shape compiles an OR-grouped cf leaf to the same correlated `EXISTS` used for ANDed cf filters, gated on key resolution — the count-side mirror of the display query's `cfValueExprByKey` applicability test — so a disjunct is never narrowed by a dropped leaf and count/display parity holds.

### 2026-08-04 — Phase 1 implemented ([#4942](https://github.com/open-mercato/open-mercato/pull/4942))

All six loops now terminate on a short page with a fail-closed page ceiling that throws (`[internal]`-prefixed), per §Short-page termination. `total`/`totalPages` are no longer loop bounds anywhere in the converted set. Line references as implemented:

- CRUD export loop — `packages/shared/src/lib/crud/factory.ts` (`EXPORT_MAX_PAGES = 1000`); loop gate is now "first page came back full", not `total > exportItems.length`.
- Custom-entity records export — `packages/core/src/modules/entities/api/records.ts` (`EXPORT_MAX_PAGES = 1000`).
- `findMatchingEntityIdsWithQueryEngine` — `packages/core/src/modules/customers/api/utils.ts`; the latent infinite loop (`Set` size vs duplicate-inflated `total`) is gone. Signature unchanged (`Promise<string[]>`); the three callers' `!== null` checks are a pre-existing dead branch left as-is.
- `fetchFilteredProductIds` — `packages/core/src/modules/catalog/widgets/injection/product-bulk-delete/widget.ts`; previously had no ceiling and no empty-page break.
- `loadLegacyActivities` — extracted from `MiniWeekCalendar.tsx` into `packages/core/src/modules/customers/components/detail/legacyActivities.ts` (`loadLegacyActivitiesInRange`) so the loop is unit-testable; the domain date-range break is preserved.
- `phoneDuplicates.ts` — `total`-derived early exit replaced with a short-page check; the deliberate `MAX_PAGES = 3` best-effort bound stays (hint feature, partial acceptable by design).

Regression coverage (per step 7): `crud-factory.test.ts` (export loop ×3), `records.export.test.ts` (×3), customers `utils.test.ts` (×4, incl. the duplicate-ids infinite-loop repro), `product-bulk-delete/__tests__/widget.test.ts` (×3), `legacyActivities.test.ts` (×4), `phoneDuplicates.test.ts` (updated to short-page fixtures, +2).

**Adjacent sites found during implementation — to fold into Phases 2–3** (all consume `total`/`totalPages` as truth but are not termination hazards, so they were out of Phase 1 scope):

- WMS `inventoryMutationLoaders.ts` loops (`while (page <= totalPages && page <= N)`, N ∈ {10, 20, 50}) — already hard-bounded, but under a capped total they under-enumerate silently; the location total-on-hand loop **sums `quantity_on_hand` across pages into a user-visible number**.
- `hasMore: offset + … < total` computations in `workflows/api/{tasks,instances,instances/[id]/events,definitions}/route.ts` and `dictionaries/api/[dictionaryId]/entries/route.ts` — a capped total flips `hasMore` to false early. Phase 2 must convert these to `items.length === limit` (or thread `totalIsCapped`).
- UI "load more" guards comparing against `totalPages`/`total`: `packages/ui/src/backend/detail/AttachmentsSection.tsx`, customers `LinkedEntitiesField.tsx`, `ParticipantsField.tsx`, `DealsSection.tsx`, `AssignRoleDialog.tsx` — a capped total hides the button early (labelling-class, Phase 3).
- `loadCanonicalInteractions` in `MiniWeekCalendar.tsx` — cursor-driven (cap-immune) but fully unbounded; `useCalendarItems.ts` (`MAX_WINDOW_ITEMS` + `truncated` flag) is the in-repo precedent if it is ever bounded.

### 2026-07-28 — Review revision

Addressing the changes-requested review on [#4552](https://github.com/open-mercato/open-mercato/pull/4552):

- **Proposed Solution rewritten.** The original `countBuilder.limit(cap + 1)` was a no-op: `LIMIT` bounds an aggregate's single output row, not the scan. Wrapping in a subquery is also insufficient where `GROUP BY`/`DISTINCT` remains, because `HashAggregate` is a blocking node. The count query is now **rebuilt** — scope + filters only, filtering joins as `EXISTS` semi-joins, projection joins dropped — which removes the barrier and makes the bound enforceable on every path, including the custom-field paths that dominate real queries. Per-site treatment table added. Noted that the rebuilt count is cheaper than today's even with the cap disabled.
- **Default settled at `OM_LIST_COUNT_CAP=10000`, on from the introducing release**, and declared a minor breaking change. An earlier draft of this revision proposed shipping disabled for one minor; that was rejected by the spec author on the grounds that opt-in does not spare large installations the problem, only the fix — they keep paying the unbounded count scan, and the population that would have to find the flag is the population the feature is for. The communication burden moves to `UPGRADE_NOTES.md`, a breaking-change release note, and the permanent `OM_LIST_COUNT_CAP=0` escape hatch. Consequence, now explicit: Phase 3 must reach every server-backed `DataTable` call site rather than a highest-traffic subset.
- **Encrypted-sort truncation decoupled from `total`.** `total > resolveEncryptedSortMaxRows()` silently stops firing once `total` is capped. Replaced with a `cap + 1` probe on the candidate scan itself.
- **Iteration ceilings now fail closed.** They throw rather than returning a partial export or a partial id set.
- **Propagation audited end to end.** `ListResponse` has zero importers, there is no shared list hook, and 65 `pagination={{ … }}` call sites parse responses individually — recorded honestly, with a phased adoption plan and a residual risk rather than a claim of completeness. Five direct-payload routes enumerated.
- **Integration tests relocated** to module `__integration__` folders per `.ai/qa/AGENTS.md:19`, and enumerated per affected path.
- **Two more count-terminated loops found** (`MiniWeekCalendar.tsx:186`, `phoneDuplicates.ts:48-50`) and one latent infinite loop documented (`customers/api/utils.ts:327` — a `Set`'s size can never reach a duplicate-inflated `total`). `TenantSelect.tsx:96-103` identified as the in-repo reference implementation.
- **One more AI prompt site found** (`catalog/ai-agents.ts:410`); confirmed no sibling pack documents the rule.
- **Two risks added**: *bound that does not bind*, and *count rebuild changing a total* (with a parity test matrix as its mitigation).
- Compiled-SQL assertions and one `EXPLAIN`-backed plan test made mandatory — a mocked total cannot catch a bound that does not bind.

### 2026-07-27
- Initial specification.
- Scope resolved to counts only; keyset/cursor pagination split to a separate future spec.
- Design reduced across three rounds: `exact | capped | none` modes → nullable per-call cap → an unconditional cap with a single additive response field, after establishing that no caller needs an exact-count opt-out once the full-result-set loops terminate on a short page.
- Added *Correctness prerequisites* (Phase 1) after an audit found sites using `total` as a loop bound.
- Market reference verified against GitLab's published pagination guidelines; the `cap + 1` probe and "N+" rendering are adopted from it, its keyset and no-page-numbers guidance explicitly deferred with rationale.
