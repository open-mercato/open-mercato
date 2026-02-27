# SPEC-042 — Multi-ID Query Parameter for CRUD List Routes

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Related** | SPEC-041 (UMES — Phase 4 API Interceptors), `makeCrudRoute` factory |

## TLDR

**Key Points:**
- Add a standardized `ids` query parameter to all `makeCrudRoute`-based list endpoints, allowing callers to filter results by multiple record IDs in a single request.
- This is a foundational building block for SPEC-041 Phase 4 (API interceptors), enabling cross-module filtering chains where an interceptor resolves a set of IDs from its domain and narrows the target module's query.

**Scope:**
- Built-in `ids` parameter in the CRUD factory GET handler (zero per-route boilerplate)
- Comma-separated UUID format: `?ids=uuid1,uuid2,uuid3`
- Automatic `$in` filter injection before `buildFilters` runs
- OpenAPI schema generation for the `ids` parameter
- 100% backward compatible — no changes to existing route schemas or `buildFilters` callbacks

**Concerns:**
- Large ID lists could degrade query performance — bounded by `pageSize` cap and a configurable max-IDs limit.

---

## Overview

Every `makeCrudRoute` list endpoint currently supports filtering via module-specific query parameters (e.g., `?status=active`, `?email=john@example.com`). However, there is no standard way to say "give me these specific records by ID." Some routes have ad-hoc `ids` parameters (categories, organizations), while most routes only support single `?id=<uuid>`.

This spec introduces a **universal `ids` query parameter** at the CRUD factory level, so every list route automatically supports multi-ID filtering without per-route code changes.

> **Market Reference**: Medusa.js supports `?id[]=uuid1&id[]=uuid2` on all list endpoints. Shopify Admin API uses `?ids=1,2,3` as a comma-separated parameter. We adopt the comma-separated format (Shopify pattern) because it works naturally with `Object.fromEntries(url.searchParams.entries())` — the current query parsing approach in `makeCrudRoute`. Medusa's array syntax would require `url.searchParams.getAll()`, which is a larger refactor.

---

## Problem Statement

### Current State

1. **Inconsistent multi-ID support**: Only 3 out of 15+ CRUD routes support `ids` filtering, each with its own ad-hoc implementation:
   - `catalog/categories`: local `parseIds()` function, client-side filtering
   - `directory/organizations`: local `parseIds()` function, ORM `$in` query
   - `catalog/products`: `parseIdList()` helper for related entity IDs (channels, categories, tags) but no top-level `ids` parameter

2. **No standard `ids` for core entities**: Routes like `customers/people`, `sales/orders`, `catalog/products` only accept `?id=<single-uuid>`. A caller needing 10 specific customers must make 10 requests or implement client-side filtering.

3. **UMES interceptor chain bottleneck**: SPEC-041 Phase 4 envisions API interceptors that can narrow queries cross-module. The canonical use case:

   ```
   Module A (e.g., loyalty) has a list of customer IDs matching a criteria.
   An API interceptor on GET /api/customers/people injects ?ids=id1,id2,...
   The customers route returns only the matching subset.
   ```

   Without a standard `ids` parameter, every interceptor would need per-route knowledge of how to inject ID filters — defeating the purpose of a universal extension system.

4. **Duplicated parsing logic**: The `parseIds()` / `parseIdList()` helper is copy-pasted across routes with slight variations (some validate UUIDs, some deduplicate, some don't).

### Goal

Provide a single, factory-level `ids` query parameter that:
- Works on every `makeCrudRoute` list endpoint automatically
- Uses comma-separated UUIDs: `?ids=uuid1,uuid2,uuid3`
- Integrates cleanly with the query engine's existing `$in` operator
- Is 100% backward compatible with existing route schemas and `buildFilters` callbacks
- Serves as the standard filtering surface for UMES API interceptors

---

## Proposed Solution

### High-Level Approach

Add `ids` parsing and filter injection **inside the `makeCrudRoute` GET handler**, between Zod schema validation and the `buildFilters` call. The factory:

1. Extracts the `ids` query parameter from the URL (if present)
2. Parses it: split by comma, trim, validate as UUIDs, deduplicate, cap at `MAX_IDS_PER_REQUEST`
3. Merges `{ id: { $in: parsedIds } }` into the filter object
4. Passes the merged filters to the query engine (or ORM fallback)

The `ids` parameter is **not** added to each route's Zod `listSchema`. It is handled entirely by the factory, making it invisible to existing route code.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Factory-level, not per-route | Zero boilerplate for 15+ routes; consistent behavior; single point of maintenance |
| Comma-separated format (`?ids=a,b,c`) | Works with existing `Object.fromEntries(url.searchParams.entries())` parsing; same as Shopify |
| UUID validation on each ID | Prevents SQL injection; consistent with existing `z.string().uuid()` patterns |
| Deduplicate parsed IDs | Prevents duplicate WHERE IN entries; matches categories/organizations behavior |
| Cap at `MAX_IDS_PER_REQUEST` (default: 200) | Prevents excessively large IN clauses; configurable per-route |
| Merge with `buildFilters` output (AND semantics) | IDs narrow results further — they don't override other filters |
| Ignore if empty string or no valid UUIDs | Backward compatible — `?ids=` returns all results (as if parameter absent) |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Array syntax `?id[]=a&id[]=b` | Requires `getAll()` instead of `entries()` — larger refactor of query parsing in factory |
| POST body with ID list | Breaks REST semantics for GET; complicates caching |
| Per-route opt-in | Defeats the goal of universal support; more boilerplate |
| `idField` configuration per route | Over-engineering — the PK is always `id` per convention |

---

## User Stories / Use Cases

- **API consumer** wants to **fetch 5 specific orders by ID in one request** so that **the frontend can batch-load detail cards without N+1 API calls**
- **UMES interceptor author** wants to **inject `ids` into a target route's query** so that **cross-module filtering works without per-route knowledge**
- **Integration developer** wants to **sync specific records from Open Mercato** so that **they can pull changed records by ID list from a webhook payload**
- **Frontend developer** wants to **resolve a list of recently viewed customers** so that **the "recent" widget can fetch them in one call**

---

## Architecture

### Execution Flow (within `makeCrudRoute` GET)

```
1. Auth & context resolution        (existing — unchanged)
2. Zod schema validation            (existing — unchanged)
3. beforeList hook                   (existing — unchanged)
4. ── NEW: Parse `ids` parameter ──
   │  Extract from raw query params (not from Zod-validated object)
   │  Split by comma → trim → UUID validate → deduplicate → cap
   │  If empty after parsing → skip (no filter added)
   │
5. buildFilters callback            (existing — unchanged, receives Zod-validated query)
   │
6. ── NEW: Merge `ids` filter ──
   │  If parsed IDs exist:
   │    filters.id = { $in: parsedIds }
   │  If buildFilters already set filters.id:
   │    Intersect: keep only IDs that are in BOTH sets
   │
7. Query engine / ORM query         (existing — unchanged, receives merged filters)
8. afterList hook                    (existing — unchanged)
9. Cache store                       (existing — unchanged)
10. Return response                  (existing — unchanged)
```

### Key Integration Point

The `ids` filter is applied **after** `buildFilters` returns but **before** the query executes. This means:

- `buildFilters` is unaware of `ids` — it continues to work exactly as today
- If `buildFilters` already set `filters.id` (e.g., single `?id=uuid` in people route), the factory **intersects** the two sets:
  - `buildFilters` sets `id = { $eq: 'abc' }` AND `ids=abc,def` → result: `id = { $in: ['abc'] }` (intersection)
  - `buildFilters` sets `id = { $eq: 'abc' }` AND `ids=def,ghi` → result: `id = { $in: [] }` (no match — returns empty)
- If `buildFilters` sets `id = { $in: [...] }` (e.g., products route intersection logic), the factory intersects with the `ids` parameter set

### Intersection Logic (Pseudocode)

```typescript
function mergeIdFilter(
  existingFilters: Where,
  parsedIds: string[] | null
): Where {
  if (!parsedIds || parsedIds.length === 0) return existingFilters

  const existingId = existingFilters.id
  if (!existingId) {
    // No existing ID filter — add the ids filter directly
    return { ...existingFilters, id: { $in: parsedIds } }
  }

  // Existing ID filter present — intersect
  const idsSet = new Set(parsedIds)

  if (typeof existingId === 'string') {
    // Direct equality: id = 'uuid'
    const keep = idsSet.has(existingId) ? [existingId] : []
    return { ...existingFilters, id: { $in: keep } }
  }

  if (typeof existingId === 'object' && existingId !== null) {
    if ('$eq' in existingId) {
      const eqVal = existingId.$eq as string
      const keep = idsSet.has(eqVal) ? [eqVal] : []
      return { ...existingFilters, id: { $in: keep } }
    }
    if ('$in' in existingId) {
      const existing = (existingId.$in as string[]) ?? []
      const intersected = existing.filter((v) => idsSet.has(v))
      return { ...existingFilters, id: { $in: intersected } }
    }
  }

  // Unrecognized operator — ids filter takes precedence
  return { ...existingFilters, id: { $in: parsedIds } }
}
```

### UMES Interceptor Integration (Future — SPEC-041 Phase 4)

When API interceptors land, the `before` hook can inject `ids` via the `query` field:

```typescript
// Example: loyalty module narrows customer list to gold-tier members
const interceptor: ApiInterceptor = {
  id: 'loyalty.filter-gold-customers',
  targetRoute: 'customers/people',
  methods: ['GET'],
  features: ['loyalty.view'],
  async before(request, ctx) {
    const goldCustomerIds = await getGoldTierCustomerIds(ctx)
    return {
      ok: true,
      query: { ids: goldCustomerIds.join(',') },
    }
  },
}
```

The factory's `ids` parsing runs on the **merged** query params (original + interceptor-injected), so the chain works naturally:

```
Original request: GET /api/customers/people?status=active
    ↓
Interceptor A injects: ids=id1,id2,id3,id4,id5
    ↓
Interceptor B narrows: ids=id2,id3  (intersection of A's result with B's criteria)
    ↓
Factory parses ids=id2,id3
Factory applies buildFilters (status=active)
Factory merges: WHERE id IN ('id2','id3') AND status = 'active'
```

---

## Data Models

No new database tables or entities. This spec modifies only the runtime query pipeline.

---

## API Contracts

### Universal `ids` Parameter (All List Endpoints)

**Added to every `makeCrudRoute`-based GET endpoint.**

| Parameter | Type | Format | Description |
|-----------|------|--------|-------------|
| `ids` | `string` | Comma-separated UUIDs | Filter results to only include records with matching IDs. Max 200 IDs. |

**Examples:**

```
GET /api/customers/people?ids=550e8400-e29b-41d4-a716-446655440001,550e8400-e29b-41d4-a716-446655440002
GET /api/catalog/products?ids=id1,id2,id3&channelIds=ch1
GET /api/sales/orders?ids=ord1,ord2&status=active
```

**Behavior:**

| Scenario | Result |
|----------|--------|
| `?ids=` (empty) | Parameter ignored — returns all results (same as omitted) |
| `?ids=valid-uuid` | Returns only that one record (if it matches other filters) |
| `?ids=valid1,valid2,invalid` | Invalid UUIDs silently dropped; filters by `valid1,valid2` |
| `?ids=all-invalid` | All dropped → parameter ignored → returns all results |
| `?ids=id1,id2&id=id1` | Intersection: returns only `id1` (both filters must match) |
| `?ids=id1,id2` + `buildFilters` sets `id.$in=[id2,id3]` | Intersection: returns only `id2` |
| `?ids=...200+` | Truncated to first 200 valid UUIDs |

**Response format:** Unchanged — standard paginated response `{ items, total, page, pageSize }`.

### OpenAPI Schema Addition

Every `makeCrudRoute` endpoint that has `list` configured will include the `ids` parameter in its generated OpenAPI spec:

```yaml
parameters:
  - name: ids
    in: query
    required: false
    schema:
      type: string
      description: Comma-separated list of record UUIDs to filter by. Max 200.
      example: "550e8400-e29b-41d4-a716-446655440001,550e8400-e29b-41d4-a716-446655440002"
```

---

## Migration & Compatibility

### Backward Compatibility Guarantees

| Aspect | Guarantee |
|--------|-----------|
| Existing `listSchema` Zod schemas | **Unchanged** — `ids` is NOT added to any route's schema |
| Existing `buildFilters` callbacks | **Unchanged** — called with same arguments, same types |
| Existing `?id=uuid` single-ID parameter | **Works as before** — `buildFilters` still processes it; factory intersects with `ids` if both present |
| Existing ad-hoc `?ids=` parameters (categories, organizations) | **Works as before** — these routes use custom GET handlers (not `makeCrudRoute` GET), so the factory change doesn't affect them |
| Routes without `.list` configured | **Unaffected** — factory only processes `ids` when `opts.list` is present |
| Query string without `ids` | **Unchanged** — no filter added, identical behavior to today |
| Export endpoints (`?format=csv`) | **`ids` respected** — exports the filtered subset. When `exportScope=full`, `ids` is ignored (consistent with existing behavior where `exportFullRequested` skips `buildFilters`) |
| Cache keys | **Naturally unique** — `ids` is part of the URL query string, which is already included in cache key computation |

### Migration of Existing Ad-Hoc `ids` Support

Routes that already have their own `ids` handling (categories, organizations) use **custom GET handlers** that bypass the factory's GET. No migration needed — both systems coexist.

For routes using `makeCrudRoute` GET that have ad-hoc comma-separated parameters (e.g., products' `channelIds`, `categoryIds`, `tagIds`), these remain unchanged. The new `ids` parameter only filters by the **primary key** (`id` column). Related-entity filtering continues through `buildFilters`.

---

## Implementation Plan

### Phase 1: Core Factory Change (Single PR)

**Files to modify:**

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/crud/factory.ts` | Modify | Add `ids` parsing + merge in GET handler |
| `packages/shared/src/lib/crud/ids.ts` | Create | `parseIdsParam()` and `mergeIdFilter()` utility functions |
| `packages/shared/src/lib/crud/ids.test.ts` | Create | Unit tests for parsing and merge logic |
| `packages/shared/src/lib/crud/factory.test.ts` | Modify | Integration tests for `ids` in makeCrudRoute GET |

**Step-by-step:**

1. Create `packages/shared/src/lib/crud/ids.ts` with:
   - `parseIdsParam(raw: string | null | undefined, maxIds?: number): string[]` — split, trim, UUID-validate, deduplicate, cap
   - `mergeIdFilter(existingFilters: Where, parsedIds: string[]): Where` — intersection logic
   - `MAX_IDS_PER_REQUEST` constant (default: 200)

2. In `factory.ts` GET handler, after line ~1004 (`buildFilters` call):
   - Extract `ids` from raw `queryParams` (not from `validated`)
   - Call `parseIdsParam(queryParams.ids)`
   - Call `mergeIdFilter(filters, parsedIds)`
   - Pass merged filters to query engine

3. In the ORM fallback path (non-query-engine routes), apply the same merge to the `where` clause.

4. Add `ids` to the auto-generated OpenAPI parameters for list endpoints.

5. Write unit tests covering all scenarios in the API Contracts table above.

### Phase 2: Cleanup Existing Ad-Hoc Implementations (Optional, Separate PR)

For routes that use `makeCrudRoute` GET and have their own `id` single-value filtering in `buildFilters`:
- Remove the manual `if (query.id) filters.id = { $eq: query.id }` from `buildFilters` in `customers/people/route.ts` — the factory handles it via `?ids=<single-uuid>`
- Keep existing `?id=uuid` in the Zod schema for backward compatibility (callers using `?id=uuid` continue to work through `buildFilters`)
- This is optional cleanup, not required for correctness

### Testing Strategy

**Unit tests (`ids.test.ts`):**
- `parseIdsParam`: empty, single, multiple, duplicates, invalid UUIDs, mixed valid/invalid, exceeds max
- `mergeIdFilter`: no existing filter, existing `$eq`, existing `$in`, existing direct value, intersection empty, intersection partial

**Integration tests (Playwright):**
- `GET /api/customers/people?ids=<known-id1>,<known-id2>` → returns exactly those 2 records
- `GET /api/customers/people?ids=<known-id1>,<known-id2>&status=active` → returns only active subset
- `GET /api/customers/people?ids=<nonexistent>` → returns empty `items: []`
- `GET /api/customers/people?ids=` → returns all records (same as no parameter)
- `GET /api/customers/people?ids=<id1>&id=<id1>` → returns the record (intersection match)
- `GET /api/customers/people?ids=<id1>&id=<id2>` → returns empty (intersection miss)

---

## Risks & Impact Review

### Data Integrity Failures

No write operations are introduced. The `ids` parameter is read-only filtering — it cannot cause data corruption.

### Cascading Failures & Side Effects

#### Large IN Clause Performance Degradation
- **Scenario**: A caller sends 200 UUIDs in `?ids=...`. The SQL `WHERE id IN (...)` with 200 values could be slow on unindexed tables or with concurrent requests.
- **Severity**: Medium
- **Affected area**: All list endpoints; database query performance
- **Mitigation**: (1) `MAX_IDS_PER_REQUEST = 200` hard cap — truncates silently. (2) The `id` column is always a UUID primary key with a B-tree index — `IN` queries on PKs are efficient. (3) Existing `pageSize <= 100` cap limits result set size regardless of IN list size. (4) Routes using the query engine already use indexed columns.
- **Residual risk**: A burst of many 200-ID requests could cause elevated DB load. Acceptable because: normal pagination queries on indexed PKs are comparable cost; rate limiting is handled at the HTTP layer.

### Tenant & Data Isolation Risks

#### Cross-Tenant ID Leak
- **Scenario**: A caller includes IDs belonging to another tenant in the `ids` parameter.
- **Severity**: Critical (if not mitigated)
- **Affected area**: All list endpoints
- **Mitigation**: The `ids` filter is merged with (not replacing) the existing `organization_id` and `tenant_id` scope filters. The query engine always applies `WHERE tenant_id = ? AND organization_id IN (?)` — IDs from other tenants are automatically excluded by the existing scoping. No change to scoping logic.
- **Residual risk**: None — scoping is enforced at the query engine level, which runs after `ids` merge.

### Migration & Deployment Risks

#### Backward Incompatibility with `?ids=` on Custom GET Routes
- **Scenario**: Categories and organizations routes have custom GET handlers with their own `ids` parsing. If the factory also parses `ids`, there could be double-filtering.
- **Severity**: Low
- **Affected area**: `catalog/categories`, `directory/organizations`
- **Mitigation**: These routes export **custom GET functions** that bypass `crud.GET`. The factory's `ids` parsing only runs inside the `crud.GET` function. No conflict.
- **Residual risk**: None — verified by code inspection.

#### `buildFilters` Sets Conflicting `id` Filter
- **Scenario**: A route's `buildFilters` sets `filters.id = { $eq: '000...' }` (e.g., people route's `tagIdsEmpty` logic) AND the caller sends `?ids=...`. The intersection produces unexpected results.
- **Severity**: Medium
- **Affected area**: `customers/people` (tagIdsEmpty pattern)
- **Mitigation**: The intersection logic is correct by design — if `buildFilters` forces `id = impossible_uuid` (the tagIdsEmpty pattern), intersecting with any `ids` parameter will correctly return empty. This is the expected behavior: "no tags" AND "these specific IDs" = empty unless one of those IDs happens to match the impossible UUID.
- **Residual risk**: Developers must understand that `ids` narrows, never expands. Documented in this spec.

### Operational Risks

#### Cache Key Explosion
- **Scenario**: Different `ids` combinations generate different cache keys, reducing cache hit rate.
- **Severity**: Low
- **Affected area**: CRUD cache layer
- **Mitigation**: The cache key already includes the full query string. Adding `ids` doesn't change the caching mechanism — it just adds more key variety, which is expected. Cache invalidation by tags (entity-level) still works correctly.
- **Residual risk**: Slightly lower cache hit rate for `ids`-filtered requests. Acceptable because these are typically targeted fetches, not repeated queries.

---

## Final Compliance Report — 2026-02-24

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No new entities or cross-module relationships |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | Existing scoping unchanged; `ids` merged with scope filters |
| root AGENTS.md | Validate all inputs with zod | Compliant | UUID validation via regex in `parseIdsParam`; factory Zod schema unchanged |
| root AGENTS.md | No `any` types | Compliant | `parseIdsParam` returns `string[]`; `mergeIdFilter` uses `Where` type |
| root AGENTS.md | `pageSize` at or below 100 | Compliant | `ids` respects existing pagination; does not bypass pageSize |
| root AGENTS.md | API routes MUST export `openApi` | Compliant | `ids` parameter added to auto-generated OpenAPI schema |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` — never raw `fetch` | N/A | No frontend changes |
| root AGENTS.md | Never hand-write migrations | Compliant | No database changes |
| packages/core AGENTS.md | CRUD routes use `makeCrudRoute` with `indexer` | Compliant | No changes to route configuration |
| packages/shared AGENTS.md | Boolean parsing: use `parseBooleanToken` | N/A | No boolean parameters added |
| packages/cache AGENTS.md | Tag-based invalidation | Compliant | Cache keys naturally include `ids` via query string |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new data models; API contract is additive query parameter |
| API contracts match existing patterns | Pass | Comma-separated IDs match existing `tagIds`, `channelIds` patterns |
| Risks cover all write operations | Pass | No write operations introduced |
| Cache strategy covers all read APIs | Pass | Cache key includes full query string; `ids` naturally part of key |
| Backward compatibility verified | Pass | All existing routes, schemas, and `buildFilters` unchanged |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

---

## Changelog

### 2026-02-24
- Initial specification
