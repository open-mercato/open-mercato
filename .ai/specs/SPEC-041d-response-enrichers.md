# SPEC-041d — Response Enrichers (Data Federation)

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | D (PR 4) |
| **Branch** | `feat/umes-response-enrichers` |
| **Depends On** | Nothing (independent) |
| **Status** | Implemented (2026-02-25) |

## Goal

Allow modules to enrich other modules' API responses without touching core code — similar to GraphQL Federation's `@extends`. This is the data backbone that enables column injection (Phase F), field injection (Phase G), and detail page bindings (Phase I).

---

## Scope

### 1. Response Enricher Contract

```typescript
// packages/shared/src/lib/crud/response-enricher.ts

interface ResponseEnricher<TRecord = any, TEnriched = any> {
  id: string
  targetEntity: string  // e.g., 'customers.person'
  features?: string[]
  priority?: number
  enrichOne(record: TRecord, context: EnricherContext): Promise<TRecord & TEnriched>
  enrichMany?(records: TRecord[], context: EnricherContext): Promise<(TRecord & TEnriched)[]>
}

interface EnricherContext {
  organizationId: string
  tenantId: string
  userId: string
  em: EntityManager  // Read-only access
  requestedFields?: string[]
}
```

### 2. Integration with `makeCrudRoute`

Enrichers run **after** the existing `afterList` hook, preserving all current hook contracts:

```
1. Core query (existing — unchanged)
2. CrudHooks.afterList (existing — unchanged, receives raw results)
3. Apply enrichers (NEW — runs AFTER afterList)
4. Return HTTP response
```

**Ordering guarantee**: Enrichers run after `CrudHooks.afterList`. Existing hooks see raw data — no behavioral change. Enriched fields are only in the final HTTP response.

**Export handling**: `_meta` field from enrichers is stripped by `normalizeFullRecordForExport` before CSV/JSON export.

### 3. Registration & Auto-Discovery

```typescript
// In module's data/enrichers.ts (new auto-discovered file)
export const enrichers: ResponseEnricher[] = [...]
```

`yarn generate` discovers `data/enrichers.ts` and generates `enrichers.generated.ts`. Bootstrap registration follows existing pattern: generated files → `globalThis` for HMR.

### 4. Response Metadata

When enrichers are active, responses include metadata:

```json
{
  "data": { /* enriched record */ },
  "_meta": {
    "enrichedBy": ["loyalty.customer-points", "credit.score"]
  }
}
```

### 5. Guardrails

- Enrichers MUST NOT modify or remove existing fields (additive only)
- Enrichers MUST NOT perform writes (read-only EntityManager)
- Enrichers run after core query, not inside the transaction
- `enrichMany` MUST be implemented for list endpoints (N+1 prevention); missing implementation fails list enrichment for that enricher
- Enrichers can be disabled per-tenant via module config
- Total enricher execution time is logged; slow enrichers flagged in dev mode (100ms warn, 500ms error)

### 5.1 Timeout & Fallback Strategy

Integration enrichers depend on cached external data or external API calls — they can be slow or fail. A failed enricher MUST NOT break the entire response.

```typescript
interface ResponseEnricher<TRecord = any, TEnriched = any> {
  // ... existing fields ...

  /** Maximum execution time in ms before the enricher is skipped (default: 2000) */
  timeout?: number

  /** Fallback value to merge into the record when the enricher times out or throws */
  fallback?: Record<string, unknown>

  /** If true, enricher errors propagate as HTTP errors. If false (default), enricher is silently skipped on failure. */
  critical?: boolean
}
```

**Execution behavior:**

```typescript
// Enricher runner (simplified)
for (const enricher of sortedEnrichers) {
  try {
    const result = await Promise.race([
      enricher.enrichOne(record, context),
      timeoutPromise(enricher.timeout ?? 2000),
    ])
    record = result
  } catch (err) {
    if (enricher.critical) throw err  // Propagate — HTTP 500
    // Non-critical: apply fallback and continue
    if (enricher.fallback) {
      record = { ...record, ...enricher.fallback }
    }
    console.warn(`[UMES] Enricher ${enricher.id} failed: ${err.message}`)
    // Add to _meta.enricherErrors for observability
  }
}
```

**Integration enricher example with fallback:**

```typescript
{
  id: 'hubspot.contact-company',
  targetEntity: 'customers.person',
  features: ['hubspot.view'],
  timeout: 1500,   // External API — shorter timeout
  critical: false,  // Don't break the response if HubSpot is down
  fallback: { _hubspot: { company: null, lastSyncedAt: null, syncStatus: 'unavailable' } },
  async enrichOne(record, ctx) { /* ... */ },
  async enrichMany(records, ctx) { /* ... */ },
}
```

When an enricher times out or fails, `_meta.enricherErrors` lists which enrichers failed:

```json
{
  "data": { /* record with fallback data */ },
  "_meta": {
    "enrichedBy": ["loyalty.points"],
    "enricherErrors": ["hubspot.contact-company"]
  }
}
```

### 6. Caching (Optional)

```typescript
{
  cache: {
    strategy: 'read-through',
    ttl: 60,
    tags: ['loyalty', 'customers'],
    invalidateOn: ['loyalty.points.updated'],
  },
}
```

Uses existing `@open-mercato/cache` infrastructure.

---

## Example Module Additions

### `example/data/enrichers.ts`

Enricher that adds `_example.todoCount` and `_example.latestTodo` to customer person responses:

```typescript
// packages/core/src/modules/example/data/enrichers.ts
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

export const enrichers: ResponseEnricher[] = [
  {
    id: 'example.customer-todo-count',
    targetEntity: 'customers.person',
    features: ['example.view'],
    priority: 50,

    async enrichOne(record, ctx) {
      const todos = await ctx.em.find('ExampleTodo', {
        assignedToId: record.id,
        organizationId: ctx.organizationId,
      })
      const latest = todos.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]
      return {
        ...record,
        _example: {
          todoCount: todos.length,
          latestTodo: latest ? { id: latest.id, title: latest.title } : null,
        },
      }
    },

    async enrichMany(records, ctx) {
      const personIds = records.map(r => r.id)
      const allTodos = await ctx.em.find('ExampleTodo', {
        assignedToId: { $in: personIds },
        organizationId: ctx.organizationId,
      })

      // Group by assignedToId
      const todosByPerson = new Map<string, any[]>()
      for (const todo of allTodos) {
        const list = todosByPerson.get(todo.assignedToId) ?? []
        list.push(todo)
        todosByPerson.set(todo.assignedToId, list)
      }

      return records.map(record => {
        const todos = todosByPerson.get(record.id) ?? []
        const latest = todos.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0]
        return {
          ...record,
          _example: {
            todoCount: todos.length,
            latestTodo: latest ? { id: latest.id, title: latest.title } : null,
          },
        }
      })
    },
  },
]
```

**Key**: `enrichMany` uses ONE query (`$in` with all person IDs) instead of N queries. This is the N+1 prevention pattern all enrichers must follow.

---

## Integration Tests

### TC-UMES-R01: GET single customer includes `_example.todoCount` from enricher

**Type**: API (Playwright)

**Steps**:
1. Create a customer person via API
2. Create 3 todos assigned to that customer via API
3. GET `/api/customers/people/:id`
4. Assert response includes `_example.todoCount: 3` and `_example.latestTodo` with title

**Expected**: Enriched fields present in response under `_example` namespace

**Testing notes**:
- Use `request.get()` for API calls
- Verify core fields (firstName, email) are unchanged
- Clean up: delete todos, delete customer

### TC-UMES-R02: GET customer list — `enrichMany` batches fetch

**Type**: API (Playwright)

**Steps**:
1. Create 5 customers via API
2. Create varying todo counts per customer (0, 1, 2, 3, 5)
3. GET `/api/customers/people?pageSize=25`
4. Assert each customer row has correct `_example.todoCount`

**Expected**: All 5 customers have enriched data with correct counts. No N+1 — verify by response timing (should be < 500ms for the enricher step).

**Testing notes**:
- Create fixtures in `test.beforeEach`, clean up in `test.afterEach`
- Verify customer with 0 todos has `_example.todoCount: 0` (not undefined)

### TC-UMES-R03: Enricher respects ACL features

**Type**: API (Playwright)

**Steps**:
1. Create a customer and a todo
2. As admin (has `example.view`): GET customer — verify `_example` present
3. As employee WITHOUT `example.view`: GET same customer — verify `_example` NOT present

**Expected**: Enricher runs only when user has required feature

**Testing notes**:
- Need two API contexts (admin auth, limited auth)
- Use `request.newContext()` with different auth tokens

### TC-UMES-R04: Enricher fields are `_` prefixed and additive (core fields unchanged)

**Type**: API (Playwright)

**Steps**:
1. GET a customer WITHOUT enricher (disable example module or use a customer with no todos)
2. GET same customer WITH enricher
3. Compare core fields (id, firstName, lastName, email, status)

**Expected**: Core fields are identical in both responses. Enriched response has additional `_example` namespace.

### TC-UMES-R05: Enriched `_meta.enrichedBy` includes enricher ID

**Type**: API (Playwright)

**Steps**:
1. GET a customer with enricher active
2. Check response `_meta` field

**Expected**: `_meta.enrichedBy` array includes `'example.customer-todo-count'`

### TC-UMES-R06: Enricher is tenant-safe (no cross-organization leakage)

**Type**: API (Playwright)

**Steps**:
1. Create person A in organization A and person B in organization B
2. Create todos in both organizations with distinct counts
3. As org A user, GET person A and list `/api/customers/people`
4. Assert `_example.todoCount` only reflects org A data
5. Assert person B is not returned and never contributes to org A enrichment output

**Expected**: Enrichment is scoped by `organization_id`; no cross-tenant rows or aggregates appear.

**Testing notes**:
- Use two auth contexts with different organization tokens
- Add explicit assertion that `_example.latestTodo.id` never references org B records

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/lib/crud/response-enricher.ts` |
| **NEW** | `packages/core/src/modules/example/data/enrichers.ts` |
| **MODIFY** | `packages/shared/src/lib/crud/factory.ts` (add enricher call after afterList) |
| **MODIFY** | Generator scripts (discover `data/enrichers.ts`) |
| **MODIFY** | Bootstrap registration (register enricher registry) |

**Estimated scope**: Medium — CRUD factory modification is the critical path

---

## Backward Compatibility

- `CrudHooks.afterList` receives the same raw query results as before
- Enriched fields only appear in HTTP response (after hooks complete)
- `_meta` stripped during export — CSV/JSON export unchanged
- New `data/enrichers.ts` is purely additive — modules without it have zero change
- Enricher EntityManager is read-only — cannot accidentally modify data

## Implementation Notes (2026-02-25)

### Core Implementation
- `ResponseEnricher` contract at `packages/shared/src/lib/crud/response-enricher.ts`
- Global registry at `packages/shared/src/lib/crud/enricher-registry.ts` (uses `globalThis.__openMercatoResponseEnrichers__`)
- Enricher runner at `packages/shared/src/lib/crud/enricher-runner.ts`
- CRUD factory integration at `packages/shared/src/lib/crud/factory.ts`

### Factory Integration Points
- Enrichers run at 3 list sites in GET handler: after cache hit, after query engine list, after ORM fallback list
- POST handler enriches single record in response
- `buildEnricherContext()` resolves user features via `rbacService.getGrantedFeatures()` from DI container
- `enrichListPayload()` / `enrichSingleRecord()` helper functions inside `makeCrudRoute`

### Generator & Bootstrap
- Convention file: `data/enrichers.ts` (export `enrichers: ResponseEnricher[]`)
- Generator discovery in `packages/cli/src/lib/generators/module-registry.ts` via `processStandaloneConfig`
- Generated file: `enrichers.generated.ts`
- Bootstrap entry: `EnricherBootstrapEntry` in `BootstrapData`
- Registration via `registerResponseEnrichers()` in `factory.ts`

### Performance & Safety
- Timeout via `Promise.race` (default 2000ms)
- Fallback on failure (if enricher defines `fallback`)
- `critical: true` propagates errors; `false` (default) logs and uses fallback
- ACL feature gating via `hasAllFeatures()` from `@open-mercato/shared/src/security/features.ts`
- Performance thresholds: SLOW_WARN_MS=100, SLOW_ERROR_MS=500
- Export stripping: `normalizeFullRecordForExport` removes `_meta` and `_`-prefixed fields

### Example
- `apps/mercato/src/modules/example/data/enrichers.ts` — customer todo count enricher
- Target entity: `customers.person` (opted in via `enrichers: { entityId: 'customers.person' }` in people route)
