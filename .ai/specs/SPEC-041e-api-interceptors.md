# SPEC-041e — API Interceptors

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | E (PR 5) |
| **Branch** | `feat/umes-api-interceptors` |
| **Depends On** | Phase D (Response Enrichers — for execution order), [SPEC-042](./SPEC-042-2026-02-24-multi-id-query-parameter.md) for multi-id query rewriting |
| **Status** | Draft |

## Goal

Allow modules to hook into other modules' API routes — validate, transform, or augment requests and responses.

---

## Scope

### 1. API Interceptor Contract

```typescript
// packages/shared/src/lib/crud/api-interceptor.ts

interface ApiInterceptor {
  id: string
  targetRoute: string  // e.g., 'sales/orders', 'sales/*', '*'
  methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  priority?: number
  features?: string[]
  before?(request: InterceptorRequest, context: InterceptorContext): Promise<InterceptorBeforeResult>
  after?(request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext): Promise<InterceptorAfterResult>
}

interface InterceptorBeforeResult {
  ok: boolean
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  message?: string
  statusCode?: number
  metadata?: Record<string, unknown>
}

interface InterceptorAfterResult {
  merge?: Record<string, unknown>
  replace?: Record<string, unknown>
}

interface InterceptorRequest {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Request URL path */
  url: string
  /** Parsed request body (for POST/PUT/PATCH) */
  body?: Record<string, unknown>
  /** Parsed query parameters (for GET) */
  query?: Record<string, unknown>
  /** Request headers */
  headers: Record<string, string>
}

interface InterceptorResponse {
  /** HTTP status code */
  statusCode: number
  /** Response body */
  body: Record<string, unknown>
  /** Response headers */
  headers: Record<string, string>
}

interface InterceptorContext {
  /** Current user ID */
  userId: string
  /** Current organization ID */
  organizationId: string
  /** Current tenant ID */
  tenantId: string
  /** Entity manager (read-only) */
  em: EntityManager
  /** Metadata passed from `before` to `after` hook */
  metadata?: Record<string, unknown>
}
```

### 2. Execution Order in CRUD Mutation Pipeline

```
 1. Zod schema validation (existing)
 2. API Interceptor `before` hooks               ← THIS PHASE (outermost cross-module layer)
 3. CRUD Event Handler (before)                   (Phase M — entity-level cross-module)
 4. CrudHooks.beforeCreate/Update/Delete          (existing — module-local)
 5. Mutation Guard Registry validate              (Phase M — final gate, multi-guard)
 6. Entity mutation + ORM flush                   (existing)
 7. CrudHooks.afterCreate/Update/Delete           (existing — module-local)
 8. Mutation Guard Registry afterSuccess          (Phase M)
 9. CRUD Event Handler (after)                    (Phase M — entity-level cross-module)
10. API Interceptor `after` hooks                 ← THIS PHASE (outermost cross-module layer)
11. Response Enrichers (Phase D)
12. Return HTTP response
```

**Layering**: API Interceptors operate at the HTTP/route level (outermost). CRUD Event Handlers and Mutation Guards operate at the entity level (inner). See [SPEC-041m](./SPEC-041m-mutation-lifecycle.md) for the full layering model.

**Key constraint**: Interceptor `before` runs AFTER Zod validation. If an interceptor modifies the request body, the modified body is **re-validated through the route's Zod schema**:

```typescript
const parsedInput = schema.parse(rawBody)                    // Step 1
const interceptResult = await runInterceptorsBefore(parsedInput, ctx)  // Step 2
if (!interceptResult.ok) return errorResponse(interceptResult)
const finalInput = interceptResult.body
  ? schema.parse(interceptResult.body)  // Re-validate modified body
  : parsedInput
```

### 3. Route Pattern Matching

Supports wildcards:
- `'example/todos'` — exact match
- `'example/*'` — matches `example/todos`, `example/tags`, etc.
- `'*'` — matches all routes

### 4. When to Use What

| Concern | Use | NOT |
|---------|-----|-----|
| Block/validate from UI | Widget `onBeforeSave` | Interceptor |
| Block/validate at HTTP route level | API interceptor `before` | CRUD Event Handler |
| Block/validate at entity level (cross-module) | CRUD Event Handler `before` (Phase M) | Interceptor |
| Final validation gate (locks, policies) | Mutation Guard (Phase M) | Interceptor |
| Add data to response | Response enricher | Interceptor `after` |
| React to completed mutation (async) | Event subscriber | Interceptor `after` |
| React to completed mutation (sync, cross-module) | CRUD Event Handler `after` (Phase M) | Interceptor `after` |
| Transform request before processing | Interceptor `before` | Subscriber |

### 5. `metadata` Passthrough

Arbitrary data can be passed from `before` to `after` hooks via `InterceptorBeforeResult.metadata`, received in `ctx.metadata` during `after`.

---

## Example Module Additions

### `example/api/interceptors.ts`

Three interceptors demonstrating different capabilities:

```typescript
// packages/core/src/modules/example/api/interceptors.ts
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

export const interceptors: ApiInterceptor[] = [
  // 1. Logging interceptor — passthrough (demonstrates before hook)
  {
    id: 'example.log-todo-mutations',
    targetRoute: 'example/todos',
    methods: ['POST', 'PUT'],
    features: ['example.view'],
    priority: 10,
    async before(request, ctx) {
      console.log(`[UMES Interceptor] ${request.method} ${request.url} by user ${ctx.userId}`)
      return { ok: true }
    },
  },

  // 2. Validation interceptor — rejects "BLOCKED" titles
  {
    id: 'example.block-test-todos',
    targetRoute: 'example/todos',
    methods: ['POST', 'PUT'],
    features: ['example.view'],
    priority: 100,
    async before(request, ctx) {
      const title = request.body?.title as string
      if (title && title.includes('BLOCKED')) {
        return {
          ok: false,
          message: 'Todo titles containing "BLOCKED" are not allowed by the example interceptor.',
          statusCode: 422,
        }
      }
      return { ok: true }
    },
  },

  // 3. Response augmentation — adds server timestamp
  {
    id: 'example.add-server-timestamp',
    targetRoute: 'example/*',
    methods: ['GET'],
    features: ['example.view'],
    priority: 50,
    async before(request, ctx) {
      return {
        ok: true,
        metadata: { requestReceivedAt: Date.now() },
      }
    },
    async after(request, response, ctx) {
      return {
        merge: {
          _example: {
            ...(response.body?._example ?? {}),
            serverTimestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - (ctx.metadata?.requestReceivedAt as number ?? Date.now()),
          },
        },
      }
    },
  },
]
```

---

## Integration Tests

### TC-UMES-I01: Interceptor `before` rejects POST with 422 when title contains "BLOCKED"

**Type**: API (Playwright)

**Steps**:
1. POST `/api/example/todos` with body `{ title: "BLOCKED item", ... }`
2. Assert response status is 422
3. Assert response body contains message about "BLOCKED"

**Expected**: Request rejected with 422 and descriptive error message

**Testing notes**:
- Use `request.post()` with invalid title
- Verify that a valid title (without "BLOCKED") succeeds (TC-UMES-I02)
- Clean up any created records

### TC-UMES-I02: Interceptor `before` allows valid POST to proceed

**Type**: API (Playwright)

**Steps**:
1. POST `/api/example/todos` with body `{ title: "Normal todo", ... }`
2. Assert response status is 200/201

**Expected**: Request proceeds normally, todo is created

### TC-UMES-I03: Interceptor `after` merges `_example.serverTimestamp` into GET response

**Type**: API (Playwright)

**Steps**:
1. Create a todo via API
2. GET `/api/example/todos/:id`
3. Assert response includes `_example.serverTimestamp` (ISO date string)
4. Assert response includes `_example.processingTimeMs` (number)

**Expected**: Enriched `_example` namespace includes server timestamp and processing time

### TC-UMES-I04: Interceptor with wildcard `example/*` matches `example/todos` and `example/tags`

**Type**: API (Playwright)

**Steps**:
1. GET `/api/example/todos` — assert `_example.serverTimestamp` present
2. GET `/api/example/tags` (if exists) — assert `_example.serverTimestamp` present
3. GET `/api/customers/people` — assert `_example.serverTimestamp` NOT present (different route)

**Expected**: Wildcard `example/*` matches only example module routes

### TC-UMES-I05: Interceptor `before` modifying body — modified body is re-validated through Zod

**Type**: API (Playwright)

**Steps**:
1. Create an interceptor that modifies body (e.g., adds an invalid field)
2. POST request
3. Assert Zod validation error for the modified invalid field

**Expected**: Modified body goes through Zod re-validation — invalid modifications are caught

**Testing notes**: This may require a dedicated test interceptor or can be verified via the example interceptor by checking that valid modifications pass.

### TC-UMES-I06: `metadata` passthrough between `before` and `after` hooks works

**Type**: API (Playwright)

**Steps**:
1. GET `/api/example/todos/:id`
2. Assert `_example.processingTimeMs` is a positive number (proves `before` stored `requestReceivedAt` in metadata and `after` read it)

**Expected**: `processingTimeMs` > 0 (metadata successfully passed from before to after)

### TC-UMES-I07: Interceptor query/body rewrites remain tenant-safe

**Type**: API (Playwright)

**Steps**:
1. Prepare records in organization A and organization B
2. Run interceptor-enabled request from organization A that rewrites query/body (for example adds `ids`)
3. Assert response contains only organization A records
4. Repeat with organization B user and assert isolation is preserved

**Expected**: Interceptor rewrites do not bypass `organization_id` isolation.

**Testing notes**:
- Use two authenticated contexts with distinct orgs
- Include assertion that rewritten `ids` containing foreign-org IDs do not leak data

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/lib/crud/api-interceptor.ts` |
| **NEW** | `packages/core/src/modules/example/api/interceptors.ts` |
| **MODIFY** | `packages/shared/src/lib/crud/factory.ts` (add interceptor calls at pipeline positions) |
| **MODIFY** | Generator scripts (discover `api/interceptors.ts`) |
| **MODIFY** | Bootstrap registration (register interceptor registry) |

**Estimated scope**: Medium-Large — CRUD factory pipeline modification

---

## Backward Compatibility

- Interceptor `before` runs AFTER existing Zod validation — existing validation unchanged
- `CrudHooks.before*` receive the same (or re-validated) input as before
- `CrudHooks.after*` run before interceptor `after` — see same data as today
- `validateCrudMutationGuard` position unchanged (deprecated in Phase M, bridged to guard registry)
- New `api/interceptors.ts` is purely additive — modules without it have zero change
- Phase M adds CRUD Event Handlers and multi-guard registry between interceptors and CrudHooks — interceptor contract unchanged
