# SPEC-041n — Query Engine Extensibility (Unified Query-Level Enrichers + Sync Query Events)

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | N |
| **Branch** | `feat/umes-query-engine-extensibility` |
| **Depends On** | [SPEC-041d — Response Enrichers](./SPEC-041d-response-enrichers.md), [SPEC-041m2 — Sync Event Subscribers](./SPEC-041m2-sync-event-subscribers.md) |
| **Status** | Draft |
| **Created** | 2026-02-26 |

## TLDR

Make UMES query engines (both `BasicQueryEngine` and `HybridQueryEngine`) extensible with a single, backward-compatible mechanism:

1. Existing response enrichers get an **optional query-level flag**. When enabled, the same enricher can participate in data queries (not only API response shaping).
2. A **unified enricher registry** serves API handlers and query engines from one source of truth.
3. Query engines emit **synchronous lifecycle events** (`*.querying`, `*.queried`) using SPEC-041m sync subscriber semantics, so extensions can safely modify query filters/options and final results.

No existing API route, enricher, subscriber, or query engine contract is removed or renamed.

---

## Problem Statement

Phase D enrichers currently run only in CRUD API response assembly (`makeCrudRoute` flow). They do not run for direct `queryEngine.query(...)` consumers. This creates three gaps:

1. Query-layer consumers cannot reuse UMES enrichment logic.
2. `BasicQueryEngine` and `HybridQueryEngine` have no common extension hook contract.
3. There is no synchronous query lifecycle interception equivalent to mutation lifecycle hooks from Phase M.

Result: query behavior is less extensible than mutation and response pipelines.

---

## Proposed Solution

### 1. Query-Level Enricher Opt-In (Additive)

Extend `ResponseEnricher` with an optional query configuration block:

```ts
interface ResponseEnricher<TRecord = any, TEnriched = any> {
  // existing fields unchanged

  queryEngine?: {
    enabled: boolean
    engines?: Array<'basic' | 'hybrid'>   // default: both
    applyOn?: Array<'list' | 'detail'>     // default: ['list', 'detail']
  }
}
```

Behavior:
- If `queryEngine` is omitted, behavior remains exactly as today (API-only enrichment).
- If `queryEngine.enabled === true`, the enricher can run in query-engine pipelines.

### 2. Unified Enricher Registry

Evolve registry reads to support selection by execution surface:

```ts
getEnrichersForEntity(targetEntity, {
  surface: 'api-response' | 'query-engine',
  engine?: 'basic' | 'hybrid',
})
```

Rules:
- API keeps using all active enrichers as before.
- Query engine receives only enrichers with `queryEngine.enabled === true` and matching `engines`.
- Priority and feature gating semantics remain unchanged.

### 3. Sync Query Events (using SPEC-041m semantics)

Reuse `subscribers/*.ts` + `metadata.sync = true` + `priority` from SPEC-041m2.

New query lifecycle event IDs:
- Before query: `{module}.{entity}.querying`
- After query: `{module}.{entity}.queried`

Contract additions:

```ts
interface SyncQueryEventPayload {
  eventId: string
  entity: string                     // e.g. 'customers.person'
  timing: 'before' | 'after'
  engine: 'basic' | 'hybrid'
  query: QueryOptions
  result?: QueryResult<Record<string, unknown>>
  userId?: string
  organizationId?: string | null
  tenantId: string
  em: EntityManager
}

interface SyncQueryEventResult {
  ok?: boolean
  message?: string
  status?: number
  modifiedQuery?: Partial<QueryOptions>
  modifiedResult?: QueryResult<Record<string, unknown>>
}
```

Before-event (`*.querying`) may:
- Block query (`ok: false`)
- Modify query options (`modifiedQuery`)

After-event (`*.queried`) may:
- Modify results (`modifiedResult`)
- Not bypass tenant/org scoping

### 4. Shared Query Extensibility Pipeline

Introduce one shared runner used by both engines:

```text
1) build canonical query options
2) emit sync before-query event (can block/modify)
3) re-apply mandatory scope guards (tenant/org/deleted)
4) execute core engine SQL
5) apply query-level enrichers (opt-in only)
6) emit sync after-query event (can modify result)
7) return final QueryResult
```

Security rule: tenant/org constraints are immutable and always re-applied after extension modifications.

---

## Architecture

### Components

1. `packages/shared/src/lib/crud/response-enricher.ts`
- Add optional `queryEngine` field (additive-only).

2. `packages/shared/src/lib/crud/enricher-registry.ts`
- Add selector-aware accessors for query-engine usage.

3. `packages/shared/src/lib/query/query-extension-runner.ts` (new)
- Shared before/after sync event execution
- Shared query-level enricher application
- Shared scoping re-guard logic

4. `packages/shared/src/lib/query/engine.ts`
- `BasicQueryEngine` uses shared runner hooks.

5. `packages/core/src/modules/query_index/lib/engine.ts`
- `HybridQueryEngine` uses shared runner hooks.

6. Bootstrap wiring
- Reuse existing sync subscriber registry from SPEC-041m2.
- No new auto-discovery convention.

### Event Flow (Query)

```text
Client/API/Service -> queryEngine.query(entity, opts)
  -> *.querying sync subscribers
  -> (scope lock: tenant/org/deleted)
  -> DB query (basic or hybrid)
  -> query-level enrichers (opt-in)
  -> *.queried sync subscribers
  -> QueryResult
```

---

## Data Model & Contract Changes

No DB schema changes.

### Public Type Changes (Additive Only)

1. `ResponseEnricher.queryEngine?` (optional)
2. New query sync payload/result types
3. Optional selector arguments in enricher registry helpers

No required field is removed or narrowed.

---

## API Contracts

HTTP route contracts remain unchanged.

This phase extends internal query behavior for:
- CRUD list/detail routes that delegate to query engine
- Internal module services that call `queryEngine.query(...)`

No route URL or response field removals.

---

## 100% Concrete Examples

### Example A — Enricher Works on API + Query Engine

```ts
// packages/core/src/modules/example/data/enrichers.ts
export const enrichers: ResponseEnricher[] = [
  {
    id: 'example.customer-tier',
    targetEntity: 'customers.person',
    priority: 80,
    queryEngine: {
      enabled: true,
      engines: ['basic', 'hybrid'],
      applyOn: ['list', 'detail'],
    },
    async enrichOne(record, ctx) {
      const tier = await resolveTier(record.id, ctx)
      return { ...record, _example: { tier } }
    },
    async enrichMany(records, ctx) {
      const tiers = await resolveTiers(records.map((r) => String(r.id)), ctx)
      return records.map((record) => ({
        ...record,
        _example: { tier: tiers.get(String(record.id)) ?? 'standard' },
      }))
    },
  },
]
```

Result:
- `GET /api/customers/people` still receives `_example.tier`.
- `queryEngine.query('customers:person', ...)` also receives `_example.tier`.

### Example B — Sync Before-Query Subscriber Modifies Filter

```ts
// packages/core/src/modules/example/subscribers/enforce-assignee-scope.ts
export const metadata = {
  event: 'customers.person.querying',
  sync: true,
  priority: 20,
  id: 'example.enforce-assignee-scope',
}

export default async function handle(payload) {
  const current = payload.query.filters ?? {}
  return {
    ok: true,
    modifiedQuery: {
      filters: {
        ...current,
        assigned_user_id: payload.userId,
      },
    },
  }
}
```

Result:
- All customer person queries are automatically scoped to current assignee.
- Tenant/org guards are still applied by engine after this transform.

### Example C — Sync After-Query Subscriber Modifies Result

```ts
// packages/core/src/modules/example/subscribers/hide-sensitive-columns.ts
export const metadata = {
  event: 'customers.person.queried',
  sync: true,
  priority: 60,
  id: 'example.hide-sensitive-columns',
}

export default async function handle(payload) {
  if (!payload.result) return
  return {
    modifiedResult: {
      ...payload.result,
      items: payload.result.items.map((item) => {
        const { national_id, ...rest } = item
        return rest
      }),
    },
  }
}
```

Result:
- Consumers get sanitized records without changing base entity schema.

### Query-Only Example (No HTTP)

```ts
const res = await queryEngine.query('customers:customer_person_profile', {
  tenantId: auth.tenantId,
  organizationId: auth.orgId,
  fields: ['id', 'first_name', 'last_name'],
  filters: { is_active: true },
  page: { page: 1, pageSize: 50 },
})

// res.items already include query-enabled enricher fields + queried-event transforms
```

---

## Backward Compatibility & Migration

### Contract Surface Check

1. Auto-discovery conventions: unchanged (`subscribers/*.ts` reused).
2. Type interfaces: additive optional fields only.
3. Function signatures: additive optional params only.
4. Event IDs: only new IDs added (`*.querying`, `*.queried`), no renames/removals.
5. API routes: unchanged.
6. DI names: unchanged.
7. Generated file contracts: unchanged.

### Migration

- Existing enrichers require no edits.
- To enable query-level behavior, set `queryEngine.enabled = true`.
- Existing sync mutation subscribers continue unchanged; query subscribers are additive.

---

## Risks & Mitigations

| Risk | Severity | Scenario | Mitigation | Residual |
|------|----------|----------|------------|----------|
| Query extensions bypass scope | Critical | Subscriber removes tenant/org filter | Re-apply immutable scoping after modifications | Low |
| N+1 in query enrichers | High | Enricher uses per-row DB calls | Require `enrichMany` for list; log slow enrichers | Medium |
| Non-deterministic ordering | Medium | Conflicting subscribers/enrichers | Priority ordering + stable sort + debug logs | Low |
| Result mutation regression | Medium | After-query subscriber corrupts pagination | Validate `modifiedResult` shape before accept | Low |

---

## Integration Coverage

### API Paths

1. `GET /api/customers/people`
- Query-enabled enricher fields present.
- `customers.person.querying` subscriber can add filter.
- `customers.person.queried` subscriber can transform items.

2. `GET /api/customers/people/:id`
- Detail query includes query-enabled enricher fields.

### Key UI Paths

1. `/backend/customers/people` (DataTable)
- Table consumes transformed query results with query-level enrichers.

2. `/backend/customers/people/:id`
- Detail rendering matches query-level and API-level enrichment behavior.

### Engine-Level Tests

1. `BasicQueryEngine` executes querying/queried sync events in order.
2. `HybridQueryEngine` executes querying/queried sync events in order.
3. Query-level enricher opt-in works identically in both engines.
4. Tenant/org scoping cannot be relaxed by subscribers.

---

## Implementation Plan

### Phase N.1 — Shared Contracts + Registry

1. Add `queryEngine?` option to `ResponseEnricher`.
2. Extend enricher registry selectors for `surface` and `engine`.
3. Add unit tests for selector behavior.

### Phase N.2 — Query Sync Event Runner

1. Implement shared query sync event runner using SPEC-041m subscriber metadata (`sync`, `priority`).
2. Add query payload/result validation helpers.
3. Add block/modify behavior tests.

### Phase N.3 — Basic + Hybrid Engine Integration

1. Wire shared runner into `BasicQueryEngine.query`.
2. Wire shared runner into `HybridQueryEngine.query`.
3. Re-apply immutable tenant/org/deleted guards after modified query.

### Phase N.4 — Integration Tests + Docs

1. Add integration tests for API + direct query engine parity.
2. Add example module subscriber + enricher fixtures.
3. Update `packages/shared/AGENTS.md` and UMES docs with query extensibility usage.

---

## Final Compliance Review

| Rule | Status | Notes |
|------|--------|-------|
| No cross-module ORM relations | Compliant | No entity relation changes |
| Tenant/org isolation enforced | Compliant | Scope re-applied after query modifications |
| Additive-only contracts | Compliant | Optional fields/events only |
| Event naming convention | Compliant | `module.entity.action` (`querying`, `queried`) |
| Existing APIs preserved | Compliant | No URL/method/response field removals |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-26 | Initial draft of Phase N: query-engine extensibility with query-level enricher opt-in, unified registry, and sync query events. |
