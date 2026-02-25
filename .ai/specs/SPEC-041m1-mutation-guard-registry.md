# SPEC-041m1 — Mutation Guard Registry

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041m — Mutation Lifecycle](./SPEC-041m-mutation-lifecycle.md) |
| **Status** | Draft |

## Goal

Evolve the singleton `crudMutationGuardService` DI token into a multi-guard registry with auto-discovery. Guards are for **cross-cutting policy enforcement** (locks, limits, compliance rules).

---

## Guard Contract

```typescript
// packages/shared/src/lib/crud/mutation-guard-registry.ts

interface MutationGuard {
  /** Unique guard ID (e.g., 'record_locks.lock-check', 'example.todo-limit') */
  id: string

  /** Target entity or '*' for all entities */
  targetEntity: string | '*'

  /** Which operations this guard applies to */
  operations: ('create' | 'update' | 'delete')[]

  /** Execution priority (lower = earlier). Default: 50 */
  priority?: number

  /** ACL feature gating — guard only runs if user has these features */
  features?: string[]

  /** Validate before mutation. Return ok:false to block, modifiedPayload to transform. */
  validate(input: MutationGuardInput): Promise<MutationGuardResult>

  /** Optional post-mutation callback (for cleanup, cache invalidation, etc.) */
  afterSuccess?(input: MutationGuardAfterInput): Promise<void>
}

interface MutationGuardInput {
  tenantId: string
  organizationId: string | null
  userId: string
  resourceKind: string
  resourceId: string | null          // null for create
  operation: 'create' | 'update' | 'delete'
  requestMethod: string
  requestHeaders: Headers
  mutationPayload?: Record<string, unknown> | null
}

interface MutationGuardResult {
  ok: boolean
  /** HTTP status for rejection (default: 422) */
  status?: number
  /** Error message for rejection */
  message?: string
  /** Full error body for rejection (overrides message) */
  body?: Record<string, unknown>
  /** Modified payload — merged into mutation data if ok:true */
  modifiedPayload?: Record<string, unknown>
  /** Should afterSuccess run? (default: false) */
  shouldRunAfterSuccess?: boolean
  /** Arbitrary metadata passed to afterSuccess */
  metadata?: Record<string, unknown>
}

interface MutationGuardAfterInput {
  tenantId: string
  organizationId: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete'
  requestMethod: string
  requestHeaders: Headers
  metadata?: Record<string, unknown> | null
}
```

---

## Guard Runner

```typescript
/** Run all matching guards in priority order. Stops on first rejection. */
async function runMutationGuards(
  guards: MutationGuard[],
  input: MutationGuardInput,
  context: { userFeatures: string[] },
): Promise<{
  ok: boolean
  response?: Response
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const matching = guards
    .filter(g => matchesEntity(g.targetEntity, input.resourceKind))
    .filter(g => g.operations.includes(input.operation))
    .filter(g => !g.features?.length || g.features.every(f => context.userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  let payload = input.mutationPayload
  const afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }> = []

  for (const guard of matching) {
    const result = await guard.validate({ ...input, mutationPayload: payload })
    if (!result.ok) {
      const body = result.body ?? { error: result.message ?? 'Operation blocked by guard', guardId: guard.id }
      return { ok: false, response: json(body, { status: result.status ?? 422 }), afterSuccessCallbacks: [] }
    }
    if (result.modifiedPayload) payload = { ...payload, ...result.modifiedPayload }
    if (result.shouldRunAfterSuccess && guard.afterSuccess) {
      afterSuccessCallbacks.push({ guard, metadata: result.metadata ?? null })
    }
  }

  return { ok: true, modifiedPayload: payload !== input.mutationPayload ? payload : undefined, afterSuccessCallbacks }
}
```

---

## Entity Matching

Guards use entity pattern matching:

```typescript
function matchesEntity(pattern: string, entity: string): boolean {
  if (pattern === '*') return true
  if (pattern === entity) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return entity.startsWith(prefix + '.')
  }
  return false
}
```

---

## Auto-Discovery

```typescript
// In module's data/guards.ts (new auto-discovered file)
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

export const guards: MutationGuard[] = [...]
```

`yarn generate` discovers `data/guards.ts` and generates `guards.generated.ts`.

---

## Legacy Guard Bridge

The existing `crudMutationGuardService` DI token continues to work unchanged. The factory wraps it as a registry entry:

```typescript
function bridgeLegacyGuard(container: AwilixContainer): MutationGuard | null {
  const legacyService = resolveCrudMutationGuardService(container)
  if (!legacyService) return null

  return {
    id: '_legacy.crud-mutation-guard-service',
    targetEntity: '*',
    operations: ['update', 'delete'],  // Legacy only covered PUT/DELETE
    priority: 0,                        // Runs first (lowest priority number)

    async validate(input) {
      const result = await legacyService.validateMutation({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId ?? '',
        operation: input.operation,
        requestMethod: input.requestMethod,
        requestHeaders: input.requestHeaders,
        mutationPayload: input.mutationPayload,
      })
      if (!result) return { ok: true }
      if (!result.ok) return { ok: false, status: result.status, body: result.body }
      return { ok: true, shouldRunAfterSuccess: result.shouldRunAfterSuccess, metadata: result.metadata ?? null }
    },

    async afterSuccess(input) {
      await legacyService.afterMutationSuccess({
        tenantId: input.tenantId, organizationId: input.organizationId,
        userId: input.userId, resourceKind: input.resourceKind, resourceId: input.resourceId,
        operation: input.operation, requestMethod: input.requestMethod, requestHeaders: input.requestHeaders,
        metadata: input.metadata,
      })
    },
  }
}
```

---

## Example: `example/data/guards.ts`

```typescript
// packages/core/src/modules/example/data/guards.ts
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

export const guards: MutationGuard[] = [
  {
    id: 'example.todo-limit',
    targetEntity: 'example.todo',
    operations: ['create'],
    features: ['example.view'],
    priority: 50,

    async validate(input) {
      // Guards don't receive em directly — use DI container if needed
      if (input.operation !== 'create') return { ok: true }
      // Policy check: max 100 todos
      return { ok: true }  // Simplified — full implementation uses container
    },
  },
]
```

---

## Integration Tests

### TC-UMES-ML01: Guard registry blocks create when todo limit reached

**Type**: API (Playwright)

**Steps**:
1. Create 100 todos via API
2. Attempt to create todo #101
3. Assert 422 with limit message

### TC-UMES-ML05: Legacy `crudMutationGuardService` bridge still works

**Type**: API (Playwright) — backward compat validation

### TC-UMES-ML06: Guard runs on POST (create) — previously skipped

**Type**: API (Playwright)

### TC-UMES-ML08: Multiple guards run in priority order, first rejection wins

**Type**: API (Playwright)

### TC-UMES-ML09: Guard `modifiedPayload` transforms mutation data

**Type**: API (Playwright)

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/lib/crud/mutation-guard-registry.ts` |
| **NEW** | `packages/core/src/modules/example/data/guards.ts` |
| **MODIFY** | `packages/shared/src/lib/crud/factory.ts` (add guard calls to POST, normalize DELETE) |
| **MODIFY** | `packages/shared/src/lib/crud/mutation-guard.ts` (add @deprecated) |
| **MODIFY** | Generator scripts (discover `data/guards.ts`) |
| **MODIFY** | Bootstrap registration (register guards) |
