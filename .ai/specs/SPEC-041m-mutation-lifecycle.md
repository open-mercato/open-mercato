# SPEC-041m — Mutation Lifecycle Hooks (Guard Registry + Sync Event Subscribers)

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | M (PR 13) |
| **Branch** | `feat/umes-mutation-lifecycle` |
| **Depends On** | Phase E (API Interceptors) |
| **Related** | [SPEC-035 — Mutation Guard](./SPEC-035-2026-02-22-mutation-guard-mechanism.md) |
| **Status** | Draft |

## Goal

Evolve the mutation pipeline into a fully extensible, filterable lifecycle system that **reuses the existing event system** as the filtering and discovery mechanism. Solve three gaps:

1. **Mutation Guard is singleton** — only one DI service can validate mutations (currently record-locks). Evolve to a multi-guard registry via auto-discovery (`data/guards.ts`).
2. **Guards can only block, not modify** — guards should be able to transform the mutation payload (e.g., inject default values, normalize data).
3. **CRUD events are async-only** — event subscribers (`subscribers/*.ts`) are fire-and-forget and cannot prevent or modify operations. Extend the existing subscriber pattern with **sync lifecycle events** (`sync: true`) that run inside the mutation pipeline, can block operations, and can modify data.

Also fixes:
- **Guard missing on POST (create)** — the CRUD factory only calls guards for PUT/DELETE, not POST.
- **Inconsistent guard ordering** — PUT calls `beforeUpdate` BEFORE guard; DELETE calls `beforeDelete` AFTER guard. Normalize to a consistent pipeline.

### Design Principle: Events ARE the Mechanism

Instead of creating a separate `data/crud-handlers.ts` file convention, this spec extends the **existing event system**:

- Event IDs (`customers.person.created`, `example.todo.updated`) are the filter
- Subscribers (`subscribers/*.ts`) are the handlers — with a new `sync: true` metadata flag
- The CRUD factory emits **lifecycle events** (before + after) that sync subscribers can intercept
- No new file convention for handlers. The existing subscriber auto-discovery is reused.

---

## Scope

### 1. Mutation Guard Registry

Evolve the singleton `crudMutationGuardService` DI token into a multi-guard registry with auto-discovery. Guards are for **cross-cutting policy enforcement** (locks, limits, compliance rules).

#### Guard Contract

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

#### Guard Runner

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

#### Auto-Discovery

```typescript
// In module's data/guards.ts (new auto-discovered file)
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

export const guards: MutationGuard[] = [...]
```

`yarn generate` discovers `data/guards.ts` and generates `guards.generated.ts`.

### 2. Sync Event Subscribers — Lifecycle Events

Extend the existing event subscriber system to support **synchronous lifecycle events** that run inside the mutation pipeline. This reuses the existing `subscribers/*.ts` auto-discovery and event ID filtering.

#### Lifecycle Event Naming Convention

The CRUD factory auto-derives **before-events** from existing event config using present continuous tense:

| Existing After-Event (past tense) | Auto-Derived Before-Event (present continuous) |
|-----------------------------------|-------------------------------------------------|
| `customers.person.created` | `customers.person.creating` |
| `customers.person.updated` | `customers.person.updating` |
| `customers.person.deleted` | `customers.person.deleting` |
| `example.todo.created` | `example.todo.creating` |
| `sales.order.updated` | `sales.order.updating` |

**Rule**: Before-event IDs are NOT declared in `events.ts`. They are auto-derived by the CRUD factory from the existing event config: `{module}.{entity}.created` → `{module}.{entity}.creating`. This keeps `events.ts` clean — modules only declare the after-events they already have.

#### Extended Subscriber Metadata

```typescript
// Existing metadata fields (unchanged):
export const metadata = {
  event: 'customers.person.creating',  // Event ID to subscribe to (including lifecycle events)
  persistent: false,                    // Queue-backed vs in-process (not applicable for sync)
  id: 'my-subscriber',                 // Optional unique identifier
  // New fields:
  sync: true,                          // NEW: Run synchronously in mutation pipeline
  priority: 50,                        // NEW: Execution order (lower = earlier). Default: 50
}
```

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `event` | string | required | Event ID — supports lifecycle events (`*.creating`, `*.updating`, `*.deleting`) |
| `persistent` | boolean | `false` | Ignored when `sync: true` (sync always runs in-process) |
| `id` | string | — | Optional unique subscriber identifier |
| `sync` | boolean | `false` | **NEW**: Run synchronously in the CRUD factory pipeline |
| `priority` | number | `50` | **NEW**: Execution order for sync subscribers (lower = earlier) |

#### Sync Subscriber Handler Contract

Sync subscribers receive a richer payload than async subscribers and can return a result:

```typescript
// packages/shared/src/lib/crud/sync-event-types.ts

interface SyncCrudEventPayload {
  /** The full event ID (e.g., 'customers.person.creating') */
  eventId: string
  /** Entity identifier (e.g., 'customers.person') */
  entity: string
  /** CRUD operation */
  operation: 'create' | 'update' | 'delete'
  /** 'before' for *.creating/*.updating/*.deleting, 'after' for *.created/*.updated/*.deleted */
  timing: 'before' | 'after'
  /** Resource ID (null for create before-events) */
  resourceId?: string | null
  /** Mutation payload (the data being created/updated) */
  payload?: Record<string, unknown>
  /** For updates: entity data before the mutation */
  previousData?: Record<string, unknown>
  /** The mutated entity (only available for after-events) */
  entity_data?: Record<string, unknown>
  /** Current user ID */
  userId: string
  /** Current organization ID */
  organizationId: string | null
  /** Current tenant ID */
  tenantId: string
  /** Entity manager (read-only recommended) */
  em: EntityManager
  /** Original HTTP request */
  request: Request
}

interface SyncCrudEventResult {
  /** If false, blocks the operation (before-events only). Default: true */
  ok?: boolean
  /** Error message when blocking */
  message?: string
  /** HTTP status code when blocking (default: 422) */
  status?: number
  /** Error body when blocking (overrides message) */
  body?: Record<string, unknown>
  /** Modified payload — merged into mutation data (before-events only) */
  modifiedPayload?: Record<string, unknown>
}
```

**Handler signature** — same default export as existing subscribers, with enriched types:

```typescript
// Sync before-subscriber:
export default async function handle(
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<SyncCrudEventResult | void> {
  // Return { ok: false } to block
  // Return { modifiedPayload } to transform
  // Return void or { ok: true } to pass through
}

// Sync after-subscriber:
export default async function handle(
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<void> {
  // After-subscribers cannot block or modify
}
```

#### Sync Event Runner

```typescript
// packages/shared/src/lib/crud/sync-event-runner.ts

/** Collect sync subscribers matching an event ID, sorted by priority */
function collectSyncSubscribers(
  allSyncSubscribers: SyncSubscriberEntry[],
  eventId: string,
): SyncSubscriberEntry[] {
  return allSyncSubscribers
    .filter(s => matchesEventPattern(s.metadata.event, eventId))
    .sort((a, b) => (a.metadata.priority ?? 50) - (b.metadata.priority ?? 50))
}

/** Run sync before-event subscribers. Stops on first rejection. */
async function runSyncBeforeEvent(
  subscribers: SyncSubscriberEntry[],
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<{ ok: boolean; response?: Response; modifiedPayload?: Record<string, unknown> }> {
  let currentPayload = payload.payload

  for (const subscriber of subscribers) {
    const result = await subscriber.handler({ ...payload, payload: currentPayload }, ctx)

    if (result?.ok === false) {
      const body = result.body ?? { error: result.message ?? 'Operation blocked', subscriberId: subscriber.metadata.id }
      return { ok: false, response: json(body, { status: result.status ?? 422 }) }
    }

    if (result?.modifiedPayload) {
      currentPayload = { ...currentPayload, ...result.modifiedPayload }
    }
  }

  return { ok: true, modifiedPayload: currentPayload !== payload.payload ? currentPayload : undefined }
}

/** Run sync after-event subscribers (cannot block). */
async function runSyncAfterEvent(
  subscribers: SyncSubscriberEntry[],
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<void> {
  for (const subscriber of subscribers) {
    try {
      await subscriber.handler(payload, ctx)
    } catch (error) {
      console.error(`[sync-event] after-subscriber failed: ${subscriber.metadata.id}`, error)
      // After-subscribers don't block — swallow errors
    }
  }
}
```

#### Event Pattern Matching

Reuses the same wildcard matching as the existing event bus and `useAppEvent`:

```typescript
function matchesEventPattern(pattern: string, eventId: string): boolean {
  if (pattern === eventId) return true
  if (pattern === '*') return true
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  return regex.test(eventId)
}
```

This allows subscribers to match broadly:
- `customers.person.creating` — exact match
- `customers.*.creating` — all customer entity before-creates
- `*.creating` — all before-create events across all modules

#### Bootstrap: Sync Subscriber Registry

At bootstrap, sync subscribers are separated from async subscribers and indexed for fast lookup:

```typescript
// In bootstrap
const allSubscribers = discoveredSubscribers // from generated files
const syncSubscribers = allSubscribers.filter(s => s.metadata.sync === true)
const asyncSubscribers = allSubscribers.filter(s => !s.metadata.sync)

// syncSubscribers are passed to the CRUD factory
// asyncSubscribers continue to work via event bus (unchanged)
```

No new generated file is needed. The existing subscriber discovery and `subscribers.generated.ts` already handles all subscribers. The `sync` flag is just metadata — the bootstrap code splits them.

### 3. Client-Side Event Filtering

Widget event handlers can declare an operation filter to control when they fire. This allows a widget to say "only run my `onBeforeSave` for updates, not creates."

```typescript
// Added to packages/shared/src/modules/widgets/injection.ts

interface WidgetInjectionEventFilter {
  /** Only run handlers for these operations. Omit to run for all. */
  operations?: ('create' | 'update' | 'delete')[]
}

// Extended WidgetInjectionEventHandlers
interface WidgetInjectionEventHandlers<TContext, TData> {
  /** Filter which operations trigger these event handlers */
  filter?: WidgetInjectionEventFilter
  // ... all existing handlers unchanged ...
}
```

#### CrudForm Integration

The CrudForm save pipeline already knows the current operation (create vs update). When invoking widget event handlers, it checks the `filter`:

```typescript
// In CrudForm save pipeline (pseudocode)
for (const widget of injectedWidgets) {
  const filter = widget.eventHandlers?.filter
  if (filter?.operations && !filter.operations.includes(currentOperation)) {
    continue  // Skip this widget's handlers for this operation
  }
  await widget.eventHandlers?.onBeforeSave?.(data, context)
}
```

The `InjectionContext` is extended to include the current operation:

```typescript
interface InjectionContext {
  // ... existing fields ...
  /** Current CRUD operation being performed */
  operation: 'create' | 'update' | 'delete'
}
```

### 4. Unified Mutation Pipeline

The complete, normalized pipeline with all extension points labeled:

```
CLIENT SIDE:
  1. [UI]    Client-side Zod validation                         (existing)
  2. [UI]    Widget onBeforeSave handlers                       (existing — NEW: filtered by operation)
  3. [UI]    Widget transformFormData pipeline                   (Phase C — NEW: filtered by operation)

SERVER SIDE:
  4. [API]   Server-side Zod validation                         (existing)
  5. [API]   API Interceptor before hooks                       (Phase E — cross-module, route-level)
  6. [API]   Sync before-event subscribers (*.creating/etc.)    (Phase M — cross-module, event-driven) ← NEW
  7. [API]   CrudHooks.beforeCreate/Update/Delete               (existing — module-local, per-route)
  8. [API]   Mutation Guard Registry validate                   (Phase M — cross-module, entity-level) ← EVOLVED
  9. [Core]  Entity mutation + ORM flush                        (existing)
 10. [API]   CrudHooks.afterCreate/Update/Delete                (existing — module-local, per-route)
 11. [API]   Mutation Guard Registry afterSuccess               (Phase M — cross-module) ← EVOLVED
 12. [API]   Sync after-event subscribers (*.created/etc.)      (Phase M — cross-module, event-driven) ← NEW
 13. [API]   API Interceptor after hooks                        (Phase E — cross-module, route-level)
 14. [API]   Response Enrichers                                 (Phase D)
 15. [UI]    Widget onAfterSave handlers                        (existing — filtered by operation)
 16. [Async] Event Subscribers (persistent: true/false)         (existing — fire-and-forget, unchanged)
```

#### Layering Model

```
┌─────────────────────────────────────────────────────┐
│  HTTP Layer (API Interceptors)                       │  Route-level, cross-module
│  ┌─────────────────────────────────────────────────┐ │
│  │  Event Layer (Sync Subscribers)                  │ │  Event-driven, cross-module
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  Module Layer (CrudHooks)                    │ │ │  Per-route, module-local
│  │  │  ┌─────────────────────────────────────────┐ │ │ │
│  │  │  │  Gate Layer (Mutation Guards)            │ │ │ │  Final validation gate
│  │  │  │  ┌─────────────────────────────────────┐ │ │ │ │
│  │  │  │  │  Core (Entity Mutation + Flush)      │ │ │ │ │
│  │  │  │  └─────────────────────────────────────┘ │ │ │ │
│  │  │  └─────────────────────────────────────────┘ │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### When to Use What

| I want to... | Mechanism | Layer | Can Block? | Can Modify Data? |
|-------------|-----------|-------|------------|-----------------|
| Validate/reject from UI before save | Widget `onBeforeSave` | Client | Yes | No (headers only) |
| Transform form data before submission | Widget `transformFormData` | Client | No | Yes |
| Validate at HTTP route level, any method | API Interceptor `before` | HTTP | Yes | Yes (re-validated) |
| React cross-module before entity mutation | Sync subscriber for `*.creating` | Event | Yes | Yes |
| React cross-module after entity mutation (sync) | Sync subscriber for `*.created` | Event | No | No |
| Prepare/normalize data in owning module | CrudHooks.beforeCreate/Update | Module | Yes (throw) | Yes |
| Final validation gate (locks, policies) | Mutation Guard | Gate | Yes | Yes |
| Side-effect after mutation in owning module | CrudHooks.afterCreate/Update | Module | No | No |
| Cross-module cleanup after mutation | Mutation Guard afterSuccess | Gate | No | No |
| Transform response at HTTP level | API Interceptor `after` | HTTP | No | Yes |
| Enrich response with cross-module data | Response Enricher | Data | No | Yes (additive) |
| Async fire-and-forget reaction | Event Subscriber (`sync: false`) | Async | No | No |

### 5. Factory Modifications

Precise changes required in `packages/shared/src/lib/crud/factory.ts`.

The factory already has `opts.events: CrudEventsConfig` with `{ module, entity }`. It derives lifecycle event IDs:

```typescript
function deriveLifecycleEventIds(events: CrudEventsConfig) {
  const base = `${events.module}.${events.entity}`
  return {
    creating: `${base}.creating`,
    created:  `${base}.created`,
    updating: `${base}.updating`,
    updated:  `${base}.updated`,
    deleting: `${base}.deleting`,
    deleted:  `${base}.deleted`,
  }
}
```

#### 5.1 POST (Create) — Add Guard + Sync Event Calls

Currently: POST has NO mutation guard call and no lifecycle events. Add both:

```typescript
// In POST handler, after Zod parse and before entity creation:

// [NEW] Emit sync before-event: *.creating
if (opts.events) {
  const eventIds = deriveLifecycleEventIds(opts.events)
  const syncResult = await runSyncBeforeEvent(
    collectSyncSubscribers(globalSyncSubscribers, eventIds.creating),
    { eventId: eventIds.creating, entity: resourceKind, operation: 'create', payload: input, ... },
    { resolve: ctx.container.resolve },
  )
  if (!syncResult.ok) return syncResult.response!
  if (syncResult.modifiedPayload) input = { ...input, ...syncResult.modifiedPayload }
}

// Run CrudHooks.beforeCreate (existing — unchanged)
const modified = await opts.hooks?.beforeCreate?.(input, ctx)
if (modified) input = modified

// [NEW] Run mutation guard registry
const guardResult = await runMutationGuards(globalGuards, { ...guardInput, operation: 'create', resourceId: null }, ...)
if (!guardResult.ok) return guardResult.response!
if (guardResult.modifiedPayload) input = { ...input, ...guardResult.modifiedPayload }

// Entity creation (existing — unchanged)
// ...

// After mutation:
await opts.hooks?.afterCreate?.(entity, ctx)
// [NEW] Guard afterSuccess callbacks
// [NEW] Emit sync after-event: *.created
if (opts.events) {
  const eventIds = deriveLifecycleEventIds(opts.events)
  await runSyncAfterEvent(
    collectSyncSubscribers(globalSyncSubscribers, eventIds.created),
    { eventId: eventIds.created, entity: resourceKind, operation: 'create', resourceId: entity.id, entity_data: entity, ... },
    { resolve: ctx.container.resolve },
  )
}
// Existing: de.markOrmEntityChange + flushOrmEntityChanges (async events — unchanged)
```

#### 5.2 PUT (Update) — Add Sync Events, Normalize Guard Position

```typescript
// New order:
// 1. Zod parse
// 2. Sync before-event (*.updating)     ← NEW: cross-module, event-driven
// 3. hooks.beforeUpdate                  ← existing: module-local
// 4. Mutation guard registry             ← EVOLVED: multi-guard
// 5. Entity mutation + flush
// 6. hooks.afterUpdate                   ← existing: module-local
// 7. Guard afterSuccess                  ← EVOLVED: multiple callbacks
// 8. Sync after-event (*.updated)        ← NEW: cross-module, event-driven
// 9. Async events                        ← existing: unchanged
```

#### 5.3 DELETE — Normalize Pipeline + Add Sync Events

Currently: guard runs BEFORE `beforeDelete`. **Normalize** to match PUT ordering:

```typescript
// Current order (INCONSISTENT with PUT):
// 1. mutation guard validate
// 2. hooks.beforeDelete

// New order (normalized):
// 1. Sync before-event (*.deleting)     ← NEW
// 2. hooks.beforeDelete                  ← existing (MOVED before guard, matching PUT)
// 3. Mutation guard registry             ← EVOLVED
// 4. Entity delete + flush
// 5. hooks.afterDelete
// 6. Guard afterSuccess
// 7. Sync after-event (*.deleted)        ← NEW
// 8. Async events                        ← existing: unchanged
```

**Backward compatibility note**: Moving `beforeDelete` before the guard is a behavioral change. In practice this is safe because:
- `beforeDelete` typically does validation/preparation, not side-effects
- This aligns DELETE with PUT behavior, reducing surprise for module authors

#### 5.4 Sync After-Events vs Async Events

The sync after-event subscribers run BEFORE async event emission. This guarantees:
- Sync after-subscribers see the committed entity data
- Sync after-subscribers complete before the HTTP response is sent
- Async subscribers (existing) fire after the response — unchanged behavior

```
Entity mutation + ORM flush
  → CrudHooks.afterX                    (module-local, existing)
  → Guard afterSuccess                  (multi-guard, evolved)
  → Sync after-event subscribers        (NEW — run before response)
  → API Interceptor after               (route-level)
  → Response Enrichers
  → Return HTTP response
  → Async event subscribers             (existing — fire-and-forget)
```

### 6. Entity Matching (Guards)

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

Sync event subscribers use event ID matching (same as existing event bus — see §2).

---

## Backward Compatibility

### Existing Singleton Guard Bridge

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

### Existing Async Subscribers

Async subscribers (`sync: false`, which is the default) are completely unchanged. They continue to fire via the event bus after the mutation, as today. The `sync` metadata flag defaults to `false` — existing subscribers never opt in.

### Compatibility Matrix

| Existing Code | Impact | Action Required |
|--------------|--------|----------------|
| `crudMutationGuardService` DI token | **None** — auto-bridged to registry | None |
| Enterprise record-locks adapter | **None** — bridged via legacy guard | None |
| `CrudHooks.before*` / `CrudHooks.after*` | **None** — same position in pipeline | None |
| `validateCrudMutationGuard()` / `runCrudMutationGuardAfterSuccess()` | **Deprecated** — still works via registry | Add `@deprecated` JSDoc |
| Existing async subscribers (`subscribers/*.ts`) | **None** — `sync` defaults to `false` | None |
| Existing event declarations (`events.ts`) | **None** — before-events auto-derived by factory | None |
| DELETE `beforeDelete` ordering | **Changed** — now runs before guard (was after) | See note in §5.3 |
| POST (create) | **New behavior** — guards now run on create | Guards must handle `resourceId: null` |
| Widget `onBeforeSave` handlers | **None** — new `filter` field is optional | None |

---

## Example Module Additions

### `example/subscribers/auto-default-priority.ts` (Sync Before-Create)

```typescript
// packages/core/src/modules/example/subscribers/auto-default-priority.ts
import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'

export const metadata = {
  event: 'example.todo.creating',   // Before-create lifecycle event
  sync: true,                        // Run in mutation pipeline
  priority: 50,
  id: 'example.auto-default-priority',
}

export default async function handle(
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<SyncCrudEventResult | void> {
  if (!payload.payload?.priority) {
    return {
      ok: true,
      modifiedPayload: { priority: 'normal' },
    }
  }
}
```

### `example/subscribers/prevent-uncomplete.ts` (Sync Before-Update)

```typescript
// packages/core/src/modules/example/subscribers/prevent-uncomplete.ts
import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'

export const metadata = {
  event: 'example.todo.updating',   // Before-update lifecycle event
  sync: true,
  priority: 60,
  id: 'example.prevent-uncomplete',
}

export default async function handle(
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<SyncCrudEventResult | void> {
  if (payload.previousData?.status === 'completed' && payload.payload?.status === 'pending') {
    return {
      ok: false,
      status: 422,
      message: 'Cannot revert a completed todo back to pending.',
    }
  }
}
```

### `example/subscribers/audit-delete.ts` (Sync After-Delete)

```typescript
// packages/core/src/modules/example/subscribers/audit-delete.ts
import type { SyncCrudEventPayload } from '@open-mercato/shared/lib/crud/sync-event-types'

export const metadata = {
  event: 'example.todo.deleted',   // After-delete event (sync = runs before response)
  sync: true,
  priority: 50,
  id: 'example.audit-delete',
}

export default async function handle(
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<void> {
  console.log(`[UMES Audit] Todo ${payload.resourceId} deleted by user ${payload.userId}`)
  // In real implementation: write to audit log table via ctx.resolve('em')
}
```

### Cross-Module Example: Validate Customer Email on Update

A module subscribing to another module's lifecycle events:

```typescript
// packages/core/src/modules/example/subscribers/validate-customer-email.ts
import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'

export const metadata = {
  event: 'customers.person.updating',  // Subscribing to ANOTHER module's event
  sync: true,
  priority: 100,   // Run after core validators
  id: 'example.validate-customer-email',
}

export default async function handle(
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T=any>(name: string) => T },
): Promise<SyncCrudEventResult | void> {
  const email = payload.payload?.email as string | undefined
  if (email && !email.includes('@')) {
    return {
      ok: false,
      status: 422,
      message: 'Invalid email address format.',
    }
  }
  // Normalize email to lowercase
  if (email) {
    return { modifiedPayload: { email: email.toLowerCase() } }
  }
}
```

### `example/data/guards.ts` (Mutation Guard)

Guards are for policy enforcement, separate from event subscribers:

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

### Updated Widget with Client-Side Event Filter

```typescript
// packages/core/src/modules/example/widgets/injection/customer-priority-field/widget.ts
export default {
  metadata: { id: 'example.injection.customer-priority-field', title: 'Customer Priority', features: ['example.create'] },
  fields: [ /* ... existing fields ... */ ],
  eventHandlers: {
    filter: { operations: ['update'] },   // Only run validation on update, not create
    onBeforeSave: async (data, context) => {
      const priority = data['_example.priority']
      if (priority === 'critical') {
        const notes = data['notes'] ?? ''
        if (!notes || (notes as string).length < 5) {
          return { ok: false, message: 'Critical priority requires a note explaining why.', fieldErrors: { notes: 'Required for critical priority' } }
        }
      }
      return { ok: true }
    },
    onSave: async (data, context) => { /* ... existing save logic ... */ },
  },
} satisfies InjectionFieldWidget
```

---

## Where to Modify — File-by-File Reference

### New Files

| File | Purpose |
|------|---------|
| `packages/shared/src/lib/crud/mutation-guard-registry.ts` | `MutationGuard` interface, `MutationGuardInput`, `MutationGuardResult`, `runMutationGuards()`, `matchesEntity()`, `bridgeLegacyGuard()` |
| `packages/shared/src/lib/crud/sync-event-types.ts` | `SyncCrudEventPayload`, `SyncCrudEventResult` types |
| `packages/shared/src/lib/crud/sync-event-runner.ts` | `collectSyncSubscribers()`, `runSyncBeforeEvent()`, `runSyncAfterEvent()`, `matchesEventPattern()`, `deriveLifecycleEventIds()` |
| `packages/core/src/modules/example/data/guards.ts` | Example guard: todo-limit |
| `packages/core/src/modules/example/subscribers/auto-default-priority.ts` | Sync before-create subscriber |
| `packages/core/src/modules/example/subscribers/prevent-uncomplete.ts` | Sync before-update subscriber |
| `packages/core/src/modules/example/subscribers/audit-delete.ts` | Sync after-delete subscriber |

### Modified Files

| File | What Changes | Lines Affected |
|------|-------------|----------------|
| **`packages/shared/src/lib/crud/factory.ts`** | Add guard registry calls to POST, add sync lifecycle event emission to POST/PUT/DELETE, normalize DELETE ordering | POST: ~1302-1401, PUT: ~1492-1586, DELETE: ~1687-1756 |
| **`packages/shared/src/lib/commands/command-bus.ts`** | Add command interceptor calls in `execute()` (before prepare, after persistLog) and `undo()` (before handler.undo, after markUndone) | execute: ~171-217, undo: ~219-235 |
| **`packages/shared/src/lib/crud/mutation-guard.ts`** | Add `@deprecated` JSDoc to `validateCrudMutationGuard` and `runCrudMutationGuardAfterSuccess` | Lines 60-86 |
| **`packages/shared/src/modules/widgets/injection.ts`** | Add `WidgetInjectionEventFilter` interface; add optional `filter` field | Type definition section |
| **`packages/ui/src/backend/injection/InjectionSpot.tsx`** | Check `filter.operations` before invoking widget event handlers | Event dispatch logic |
| **`packages/ui/src/backend/CrudForm.tsx`** | Pass current operation to injection context; filter widget handlers | Save pipeline |
| **Bootstrap registration** | Split sync/async subscribers at bootstrap; pass sync subscribers to factory; register command interceptors | Bootstrap init file |
| **Generator scripts** (`packages/cli/`) | Discover `data/guards.ts` and `commands/interceptors.ts`; generate `guards.generated.ts` and `command-interceptors.generated.ts` | Generator module discovery |

### What Is NOT Needed (vs previous draft)

| Previous Draft | Now | Why |
|---------------|-----|-----|
| `data/crud-handlers.ts` file convention | **Removed** | Use existing `subscribers/*.ts` with `sync: true` |
| `crud-handlers.generated.ts` | **Removed** | Sync subscribers are part of existing `subscribers.generated.ts` |
| `CrudEventHandler` interface | **Removed** | Replaced by sync subscriber handler + `SyncCrudEventResult` |
| `runCrudEventHandlers()` function | **Removed** | Replaced by `runSyncBeforeEvent()` / `runSyncAfterEvent()` |

### Deprecation Plan

```typescript
// packages/shared/src/lib/crud/mutation-guard.ts

/**
 * @deprecated Use MutationGuard registry via data/guards.ts instead.
 * Bridged to the registry internally. Will be removed in a future major version.
 */
export async function validateCrudMutationGuard(...)

/**
 * @deprecated Use MutationGuard registry via data/guards.ts instead.
 * Bridged to the registry internally. Will be removed in a future major version.
 */
export async function runCrudMutationGuardAfterSuccess(...)
```

---

## Integration Tests

### TC-UMES-ML01: Guard registry blocks create when todo limit reached

**Type**: API (Playwright)

**Steps**:
1. Create 100 todos via API
2. Attempt to create todo #101
3. Assert 422 with limit message

### TC-UMES-ML02: Sync before-subscriber modifies create payload

**Type**: API (Playwright)

**Steps**:
1. POST `/api/example/todos` without `priority`
2. GET the created todo
3. Assert `priority` is `'normal'` (auto-set by sync subscriber)

### TC-UMES-ML03: Sync before-subscriber blocks update with 422

**Type**: API (Playwright)

**Steps**:
1. Create todo with `status: 'pending'`
2. Update to `status: 'completed'` — success
3. Update back to `status: 'pending'` — expect 422

### TC-UMES-ML04: Sync after-subscriber runs on delete without blocking

**Type**: API (Playwright)

**Steps**:
1. Create and delete a todo
2. Verify deletion succeeded (GET returns 404)

### TC-UMES-ML05: Legacy `crudMutationGuardService` bridge still works

**Type**: API (Playwright) — backward compat validation

### TC-UMES-ML06: Guard runs on POST (create) — previously skipped

**Type**: API (Playwright)

### TC-UMES-ML07: Client-side event filter skips handler for filtered operation

**Type**: UI (Playwright)

**Steps**:
1. Create customer with Critical priority + empty notes → succeeds (filter skips 'create')
2. Edit same customer, set Critical + empty notes → fails (filter includes 'update')

### TC-UMES-ML08: Multiple guards run in priority order, first rejection wins

**Type**: API (Playwright)

### TC-UMES-ML09: Guard `modifiedPayload` transforms mutation data

**Type**: API (Playwright)

### TC-UMES-ML10: Cross-module sync subscriber (example subscribing to customers.person.updating)

**Type**: API (Playwright)

**Steps**:
1. Update a customer person with invalid email
2. Assert 422 from the example module's sync subscriber
3. Update with valid email — success, email normalized to lowercase

---

## Files Touched Summary

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/lib/crud/mutation-guard-registry.ts` |
| **NEW** | `packages/shared/src/lib/crud/sync-event-types.ts` |
| **NEW** | `packages/shared/src/lib/crud/sync-event-runner.ts` |
| **NEW** | `packages/shared/src/lib/commands/command-interceptor.ts` — `CommandInterceptor` interface, types |
| **NEW** | `packages/shared/src/lib/commands/command-interceptor-runner.ts` — `runCommandInterceptorsBefore`, `runCommandInterceptorsAfter`, `runCommandInterceptorsBeforeUndo`, `runCommandInterceptorsAfterUndo`, `matchesCommandPattern` |
| **NEW** | `packages/shared/src/lib/commands/errors.ts` — `CommandInterceptorError` |
| **NEW** | `packages/core/src/modules/example/data/guards.ts` |
| **NEW** | `packages/core/src/modules/example/subscribers/auto-default-priority.ts` |
| **NEW** | `packages/core/src/modules/example/subscribers/prevent-uncomplete.ts` |
| **NEW** | `packages/core/src/modules/example/subscribers/audit-delete.ts` |
| **NEW** | `packages/core/src/modules/example/commands/interceptors.ts` — Example command interceptors (customer audit, loyalty tier, undo time limit) |
| **MODIFY** | `packages/shared/src/lib/commands/command-bus.ts` — Add interceptor calls in `execute()` and `undo()` |
| **MODIFY** | `packages/shared/src/lib/crud/factory.ts` (add guards + sync events to POST/PUT/DELETE, normalize pipeline) |
| **MODIFY** | `packages/shared/src/lib/crud/mutation-guard.ts` (add @deprecated) |
| **MODIFY** | `packages/shared/src/modules/widgets/injection.ts` (add WidgetInjectionEventFilter) |
| **MODIFY** | `packages/ui/src/backend/injection/InjectionSpot.tsx` (filter by operation) |
| **MODIFY** | `packages/ui/src/backend/CrudForm.tsx` (pass operation, filter handlers) |
| **MODIFY** | Generator scripts (discover `data/guards.ts` and `commands/interceptors.ts`) |
| **MODIFY** | Bootstrap registration (split sync/async subscribers, register command interceptors) |

**Estimated scope**: Large — CRUD factory pipeline + CommandBus modifications are the critical path

---

## 7. Command Interceptors

Commands (`CommandHandler` registered via `registerCommand`) provide audit logging, snapshot-based change tracking, and **undo/redo** for mutations. Currently they are closed: only the owning module can define a command's behavior. Third-party modules cannot modify how a customer save works, add cross-cutting validation before execute, inject extra side-effects after execute, or customize undo behavior.

**Command Interceptors** are the command-bus analog of API Interceptors (Phase E). They allow any module to hook before/after `execute()` and before/after `undo()` of any registered command — by command ID pattern.

### Design Principle: Symmetric with API Interceptors

| Concern | API Interceptors (Phase E) | Command Interceptors (Phase M) |
|---------|---------------------------|-------------------------------|
| Target | HTTP route pattern (`sales/orders`, `*`) | Command ID pattern (`customers.people.update`, `customers.*`, `*`) |
| Hooks | `before` / `after` | `beforeExecute` / `afterExecute` / `beforeUndo` / `afterUndo` |
| Can block? | Yes (`ok: false`) | Yes (`ok: false`) |
| Can modify input? | Yes (body re-validated through Zod) | Yes (`modifiedInput` merged — no re-validation since command owns its schema) |
| Can modify result? | Yes (`merge`/`replace`) | Yes (`modifiedResult` merged into result) |
| Auto-discovery | `api/interceptors.ts` | `commands/interceptors.ts` |
| Priority ordering | Lower = earlier | Lower = earlier |
| ACL gating | `features[]` | `features[]` |

### 7.1 Command Interceptor Contract

```typescript
// packages/shared/src/lib/commands/command-interceptor.ts

interface CommandInterceptor {
  /** Unique interceptor ID (e.g., 'example.log-customer-saves', 'compliance.block-inactive-edits') */
  id: string

  /** Target command ID pattern. Supports:
   *  - Exact: 'customers.people.update'
   *  - Module wildcard: 'customers.*'
   *  - Global wildcard: '*'
   */
  targetCommand: string

  /** Execution priority (lower = earlier). Default: 50 */
  priority?: number

  /** ACL feature gating — interceptor only runs if user has these features */
  features?: string[]

  /** Hook before command execute(). Can block or modify input. */
  beforeExecute?(
    input: unknown,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorBeforeResult | void>

  /** Hook after command execute(). Can augment result or trigger side-effects. */
  afterExecute?(
    input: unknown,
    result: unknown,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorAfterResult | void>

  /** Hook before command undo(). Can block undo. */
  beforeUndo?(
    undoContext: CommandInterceptorUndoContext,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorBeforeResult | void>

  /** Hook after command undo(). Trigger cleanup or side-effects. */
  afterUndo?(
    undoContext: CommandInterceptorUndoContext,
    context: CommandInterceptorContext,
  ): Promise<void>
}

interface CommandInterceptorContext {
  /** The resolved command ID being executed */
  commandId: string
  /** Current user auth context */
  auth: AuthContext | null
  /** Organization scope */
  organizationScope: OrganizationScope | null
  /** Selected organization ID */
  selectedOrganizationId: string | null
  /** DI container (read-only usage recommended) */
  container: AwilixContainer
  /** Metadata passthrough from beforeExecute to afterExecute (or beforeUndo to afterUndo) */
  metadata?: Record<string, unknown>
}

interface CommandInterceptorUndoContext {
  /** The original input used when the command was executed */
  input: unknown
  /** The action log entry being undone */
  logEntry: ActionLog
  /** The undo token */
  undoToken: string
}

interface CommandInterceptorBeforeResult {
  /** If false, blocks the command. Default: true */
  ok?: boolean
  /** Error message when blocking */
  message?: string
  /** Modified input — shallow-merged into command input if ok:true */
  modifiedInput?: Record<string, unknown>
  /** Metadata passed to the corresponding after hook */
  metadata?: Record<string, unknown>
}

interface CommandInterceptorAfterResult {
  /** Modified result — shallow-merged into command result */
  modifiedResult?: Record<string, unknown>
  /** Metadata (for logging/debugging — not passed further) */
  metadata?: Record<string, unknown>
}
```

### 7.2 Command Pattern Matching

Reuses the same pattern approach as entity matching (§6):

```typescript
function matchesCommandPattern(pattern: string, commandId: string): boolean {
  if (pattern === '*') return true
  if (pattern === commandId) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return commandId.startsWith(prefix + '.')
  }
  return false
}
```

Examples:
- `'customers.people.update'` — exact match for person update command
- `'customers.*'` — matches all customer commands (people, companies, deals, etc.)
- `'sales.*'` — matches all sales commands
- `'*'` — matches every command (useful for cross-cutting concerns like audit logging)

### 7.3 Command Interceptor Runner

```typescript
// packages/shared/src/lib/commands/command-interceptor-runner.ts

/** Run beforeExecute interceptors in priority order. Stops on first rejection. */
async function runCommandInterceptorsBefore(
  interceptors: CommandInterceptor[],
  commandId: string,
  input: unknown,
  context: CommandInterceptorContext,
  userFeatures: string[],
): Promise<{
  ok: boolean
  error?: { message: string }
  modifiedInput?: Record<string, unknown>
  metadataByInterceptor: Map<string, Record<string, unknown>>
}> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  let currentInput = input
  const metadataByInterceptor = new Map<string, Record<string, unknown>>()

  for (const interceptor of matching) {
    if (!interceptor.beforeExecute) continue
    const result = await interceptor.beforeExecute(currentInput, { ...context, commandId })

    if (result?.ok === false) {
      return {
        ok: false,
        error: { message: result.message ?? `Blocked by command interceptor: ${interceptor.id}` },
        metadataByInterceptor,
      }
    }

    if (result?.modifiedInput) {
      currentInput = typeof currentInput === 'object' && currentInput
        ? { ...currentInput as Record<string, unknown>, ...result.modifiedInput }
        : result.modifiedInput
    }

    if (result?.metadata) {
      metadataByInterceptor.set(interceptor.id, result.metadata)
    }
  }

  const inputChanged = currentInput !== input
  return {
    ok: true,
    modifiedInput: inputChanged ? currentInput as Record<string, unknown> : undefined,
    metadataByInterceptor,
  }
}

/** Run afterExecute interceptors. Cannot block — errors are logged and swallowed. */
async function runCommandInterceptorsAfter(
  interceptors: CommandInterceptor[],
  commandId: string,
  input: unknown,
  result: unknown,
  context: CommandInterceptorContext,
  userFeatures: string[],
  metadataByInterceptor: Map<string, Record<string, unknown>>,
): Promise<{ modifiedResult?: Record<string, unknown> }> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  let currentResult = result

  for (const interceptor of matching) {
    if (!interceptor.afterExecute) continue
    try {
      const afterResult = await interceptor.afterExecute(
        input,
        currentResult,
        { ...context, commandId, metadata: metadataByInterceptor.get(interceptor.id) },
      )
      if (afterResult?.modifiedResult && typeof currentResult === 'object' && currentResult) {
        currentResult = { ...currentResult as Record<string, unknown>, ...afterResult.modifiedResult }
      }
    } catch (error) {
      console.error(`[command-interceptor] afterExecute failed: ${interceptor.id}`, error)
    }
  }

  const resultChanged = currentResult !== result
  return { modifiedResult: resultChanged ? currentResult as Record<string, unknown> : undefined }
}

/** Run beforeUndo interceptors. Stops on first rejection. */
async function runCommandInterceptorsBeforeUndo(
  interceptors: CommandInterceptor[],
  commandId: string,
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
  userFeatures: string[],
): Promise<{
  ok: boolean
  error?: { message: string }
  metadataByInterceptor: Map<string, Record<string, unknown>>
}> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  const metadataByInterceptor = new Map<string, Record<string, unknown>>()

  for (const interceptor of matching) {
    if (!interceptor.beforeUndo) continue
    const result = await interceptor.beforeUndo(undoContext, { ...context, commandId })

    if (result?.ok === false) {
      return {
        ok: false,
        error: { message: result.message ?? `Undo blocked by command interceptor: ${interceptor.id}` },
        metadataByInterceptor,
      }
    }

    if (result?.metadata) {
      metadataByInterceptor.set(interceptor.id, result.metadata)
    }
  }

  return { ok: true, metadataByInterceptor }
}

/** Run afterUndo interceptors. Cannot block — errors are logged and swallowed. */
async function runCommandInterceptorsAfterUndo(
  interceptors: CommandInterceptor[],
  commandId: string,
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
  userFeatures: string[],
  metadataByInterceptor: Map<string, Record<string, unknown>>,
): Promise<void> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  for (const interceptor of matching) {
    if (!interceptor.afterUndo) continue
    try {
      await interceptor.afterUndo(
        undoContext,
        { ...context, commandId, metadata: metadataByInterceptor.get(interceptor.id) },
      )
    } catch (error) {
      console.error(`[command-interceptor] afterUndo failed: ${interceptor.id}`, error)
    }
  }
}
```

### 7.4 Auto-Discovery

```typescript
// In module's commands/interceptors.ts (new auto-discovered file)
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

export const interceptors: CommandInterceptor[] = [...]
```

`yarn generate` discovers `commands/interceptors.ts` and generates `command-interceptors.generated.ts` into `apps/mercato/.mercato/generated/`.

### 7.5 CommandBus Modifications

The `CommandBus.execute()` and `CommandBus.undo()` methods are extended to run interceptors at the outermost layer:

```typescript
// Existing execute() flow — with interceptor hooks added:
async execute<TInput, TResult>(commandId, options): Promise<CommandExecuteResult<TResult>> {
  const handler = this.resolveHandler(commandId)

  // [NEW] Run beforeExecute interceptors
  const beforeResult = await runCommandInterceptorsBefore(
    globalCommandInterceptors, commandId, options.input, interceptorCtx, userFeatures,
  )
  if (!beforeResult.ok) {
    throw new CommandInterceptorError(beforeResult.error!.message)
  }
  if (beforeResult.modifiedInput) {
    options = { ...options, input: { ...options.input as object, ...beforeResult.modifiedInput } as TInput }
  }

  // Existing: prepare → execute → captureAfter → buildLog → persistLog → cache
  const snapshots = await this.prepareSnapshots(handler, options)
  const result = await handler.execute(options.input, options.ctx)
  // ... existing logic ...

  // [NEW] Run afterExecute interceptors
  const afterResult = await runCommandInterceptorsAfter(
    globalCommandInterceptors, commandId, options.input, result, interceptorCtx,
    userFeatures, beforeResult.metadataByInterceptor,
  )
  // afterResult.modifiedResult is merged into the result if present

  return { result: finalResult, logEntry }
}

// Existing undo() flow — with interceptor hooks added:
async undo(undoToken, ctx): Promise<void> {
  const log = await service.findByUndoToken(undoToken)
  const handler = this.resolveHandler(log.commandId)

  // [NEW] Run beforeUndo interceptors
  const undoCtx = { input: log.commandPayload, logEntry: log, undoToken }
  const beforeResult = await runCommandInterceptorsBeforeUndo(
    globalCommandInterceptors, log.commandId, undoCtx, interceptorCtx, userFeatures,
  )
  if (!beforeResult.ok) {
    throw new CommandInterceptorError(beforeResult.error!.message)
  }

  // Existing: handler.undo() → markUndone → cache invalidation
  await handler.undo({ input: log.commandPayload, ctx, logEntry: log })
  await service.markUndone(log.id)

  // [NEW] Run afterUndo interceptors
  await runCommandInterceptorsAfterUndo(
    globalCommandInterceptors, log.commandId, undoCtx, interceptorCtx,
    userFeatures, beforeResult.metadataByInterceptor,
  )

  await this.flushCrudSideEffects(ctx.container)
}
```

### 7.6 Execute Pipeline with Command Interceptors

The full command execution pipeline becomes:

```
COMMAND EXECUTE:
  1. [Interceptor]  beforeExecute hooks (priority-sorted)           ← NEW
  2. [Command]      prepare() — capture before-snapshot              (existing)
  3. [Command]      execute() — run mutation                         (existing)
  4. [Command]      captureAfter() — capture after-snapshot          (existing)
  5. [Command]      buildLog() — audit metadata                      (existing)
  6. [Bus]          persistLog() — save ActionLog                    (existing)
  7. [Interceptor]  afterExecute hooks (priority-sorted)             ← NEW
  8. [Bus]          invalidateCrudCache()                             (existing)
  9. [Bus]          flushCrudSideEffects()                            (existing)

COMMAND UNDO:
  1. [Interceptor]  beforeUndo hooks (priority-sorted)               ← NEW
  2. [Command]      undo() — restore from snapshot                   (existing)
  3. [Bus]          markUndone() — mark ActionLog as undone           (existing)
  4. [Interceptor]  afterUndo hooks (priority-sorted)                ← NEW
  5. [Bus]          invalidateCrudCache()                             (existing)
  6. [Bus]          flushCrudSideEffects()                            (existing)
```

### 7.7 Example: Extending Customer Person Save

A third-party module that adds a loyalty score to every customer person update and prevents undo of updates older than 24 hours:

```typescript
// packages/core/src/modules/example/commands/interceptors.ts
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

export const interceptors: CommandInterceptor[] = [
  // 1. Inject loyalty score on customer person updates
  {
    id: 'example.customer-loyalty-score',
    targetCommand: 'customers.people.update',
    priority: 50,
    features: ['example.view'],

    async beforeExecute(input, ctx) {
      const record = input as Record<string, unknown>
      const email = record.primaryEmail as string | undefined

      // Example: Auto-set lifecycle stage based on email domain
      if (email && email.endsWith('@vip-corp.com')) {
        return {
          ok: true,
          modifiedInput: {
            lifecycleStage: 'enterprise',
            // Store original value for undo awareness
          },
          metadata: {
            originalLifecycleStage: record.lifecycleStage ?? null,
            appliedRule: 'vip-domain-upgrade',
          },
        }
      }

      return { ok: true }
    },

    async afterExecute(input, result, ctx) {
      // Log which customer updates were intercepted
      if (ctx.metadata?.appliedRule) {
        console.log(
          `[example] Customer ${(result as Record<string, unknown>).entityId} ` +
          `upgraded by rule: ${ctx.metadata.appliedRule}`
        )
      }
    },
  },

  // 2. Block undo of customer updates older than 24 hours
  {
    id: 'example.customer-undo-time-limit',
    targetCommand: 'customers.people.update',
    priority: 10,

    async beforeUndo(undoCtx, ctx) {
      const log = undoCtx.logEntry
      const createdAt = new Date(log.createdAt)
      const hoursAgo = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60)

      if (hoursAgo > 24) {
        return {
          ok: false,
          message: `Cannot undo changes older than 24 hours. This change was made ${Math.floor(hoursAgo)} hours ago.`,
        }
      }

      return { ok: true }
    },

    async afterUndo(undoCtx, ctx) {
      // Clean up any loyalty score side-effects that were created
      console.log(`[example] Customer undo completed for ${undoCtx.logEntry.resourceId}`)
    },
  },

  // 3. Cross-cutting: Audit all customer command executions
  {
    id: 'example.customer-command-audit',
    targetCommand: 'customers.*',
    priority: 1,  // Runs first

    async beforeExecute(input, ctx) {
      return {
        ok: true,
        metadata: { startedAt: Date.now() },
      }
    },

    async afterExecute(input, result, ctx) {
      const duration = Date.now() - ((ctx.metadata?.startedAt as number) ?? Date.now())
      console.log(`[example] Command ${ctx.commandId} completed in ${duration}ms`)
    },
  },
]
```

### 7.8 Relationship to Other Extension Layers

Command interceptors occupy a distinct position relative to other extension mechanisms:

```
┌─────────────────────────────────────────────────────┐
│  Command Interceptor (beforeExecute)                 │  Cross-module, command-level
│  ┌─────────────────────────────────────────────────┐ │
│  │  Command Handler (prepare + execute)             │ │  Module-owned, entity-level
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  (Internal: CRUD factory pipeline if route)  │ │ │  See §4 for full pipeline
│  │  └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
│  Command Interceptor (afterExecute)                  │
└─────────────────────────────────────────────────────┘
```

**When to use Command Interceptors vs other mechanisms**:

| I want to... | Mechanism | Why not the other? |
|-------------|-----------|-------------------|
| Modify input before a specific command runs | Command Interceptor `beforeExecute` | API interceptors target HTTP routes, not commands; sync subscribers target entity events, not command IDs |
| Block a specific command from executing | Command Interceptor `beforeExecute` | More precise than API interceptors (command-level vs route-level) |
| Block undo of a specific command | Command Interceptor `beforeUndo` | **Only mechanism** that can intercept undo |
| Add side-effects after command undo | Command Interceptor `afterUndo` | **Only mechanism** for post-undo hooks |
| React to entity creation/update (regardless of whether it came from a command or direct CRUD route) | Sync subscriber / API interceptor | Command interceptors only fire for `commandBus.execute()`, not direct CRUD |
| Validate at HTTP route level | API Interceptor `before` | Route-level concern, not command-level |
| Add cross-cutting policy (locks, limits) | Mutation Guard | Runs inside CRUD factory, covers both command and direct CRUD paths |

### 7.9 Error Handling

When a `beforeExecute` interceptor returns `ok: false`, the `CommandBus` throws a `CommandInterceptorError`:

```typescript
// packages/shared/src/lib/commands/errors.ts

export class CommandInterceptorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandInterceptorError'
  }
}
```

API routes and UI pages that invoke commands should handle this error and return an appropriate response (e.g., 422 with the interceptor's message). The existing `CrudHttpError` catch-and-map pattern in detail pages already handles thrown errors gracefully.

For `beforeUndo`, the error propagates to the undo caller — typically the action log undo API endpoint, which already returns the error message to the user.

---

## 8. Command Interceptor Example: Full Customer Save Extension

This section demonstrates a complete, realistic third-party module (`loyalty`) that extends the customer person save command to:
1. Auto-compute a loyalty tier from a custom field score
2. Prevent downgrading VIP customers without a reason
3. Clean up tier cache on undo

### Module Setup

```typescript
// packages/core/src/modules/loyalty/commands/interceptors.ts
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

function computeLoyaltyTier(score: number): string {
  if (score >= 90) return 'platinum'
  if (score >= 70) return 'gold'
  if (score >= 40) return 'silver'
  return 'bronze'
}

export const interceptors: CommandInterceptor[] = [
  {
    id: 'loyalty.auto-tier-on-person-save',
    targetCommand: 'customers.people.update',
    priority: 50,
    features: ['loyalty.manage'],

    async beforeExecute(input, ctx) {
      const record = input as Record<string, unknown>
      const loyaltyScore = record['cf:loyalty_score'] as number | undefined

      // If loyalty_score custom field is being updated, auto-compute the tier
      if (loyaltyScore !== undefined) {
        const newTier = computeLoyaltyTier(loyaltyScore)

        // Check if downgrading a VIP (platinum) customer without a reason note
        if (newTier !== 'platinum') {
          const em = ctx.container.resolve('em') as DataEngine
          const existing = await em.findOne('CustomerEntity', {
            id: record.id,
            deletedAt: null,
          })
          const existingTier = existing?.customValues?.['cf:loyalty_tier'] as string | undefined

          if (existingTier === 'platinum' && !record['cf:tier_change_reason']) {
            return {
              ok: false,
              message: 'Cannot downgrade a Platinum customer without providing a tier change reason (cf:tier_change_reason).',
            }
          }
        }

        return {
          ok: true,
          modifiedInput: {
            'cf:loyalty_tier': newTier,
          },
          metadata: {
            previousScore: loyaltyScore,
            computedTier: newTier,
          },
        }
      }

      return { ok: true }
    },

    async afterExecute(input, result, ctx) {
      if (ctx.metadata?.computedTier) {
        // Invalidate the loyalty tier cache for this customer
        const cache = ctx.container.resolve('cacheService')
        const entityId = (result as Record<string, unknown>).entityId as string
        await cache.invalidate(`loyalty:tier:${entityId}`)
      }
    },

    async beforeUndo(undoCtx, ctx) {
      // Allow undo — but record that we need to re-cache
      return {
        ok: true,
        metadata: { requiresCacheInvalidation: true },
      }
    },

    async afterUndo(undoCtx, ctx) {
      // Re-invalidate the tier cache after undo restores old data
      const resourceId = undoCtx.logEntry.resourceId
      if (resourceId) {
        const cache = ctx.container.resolve('cacheService')
        await cache.invalidate(`loyalty:tier:${resourceId}`)
      }
    },
  },
]
```

### How It Works End-to-End

**Update flow** (user sets loyalty_score to 95 on a person):

1. UI sends `PUT /api/customers/people/:id` with `{ ..., "cf:loyalty_score": 95 }`
2. The CRUD route invokes `commandBus.execute('customers.people.update', { input, ctx })`
3. **Command interceptor `beforeExecute`** runs:
   - Sees `cf:loyalty_score = 95`, computes tier = `'platinum'`
   - Returns `modifiedInput: { "cf:loyalty_tier": "platinum" }`
   - Input is now merged: `{ ..., "cf:loyalty_score": 95, "cf:loyalty_tier": "platinum" }`
4. Command handler `prepare()` captures before-snapshot (including old tier)
5. Command handler `execute()` saves the merged input (score + auto-computed tier)
6. Command handler `captureAfter()` captures after-snapshot
7. **Command interceptor `afterExecute`** runs: invalidates tier cache
8. ActionLog saved with undo token — snapshots contain both old and new tier values

**Undo flow** (user clicks Undo):

1. UI calls undo endpoint with the `undoToken`
2. `commandBus.undo(undoToken, ctx)` resolves the ActionLog
3. **Command interceptor `beforeUndo`** runs: allows undo, stores metadata
4. Command handler `undo()` restores before-snapshot (old score + old tier restored)
5. ActionLog marked as undone
6. **Command interceptor `afterUndo`** runs: re-invalidates tier cache

**Blocked downgrade flow** (user tries to lower a Platinum customer's score without reason):

1. UI sends update with `{ "cf:loyalty_score": 30 }` (no `cf:tier_change_reason`)
2. Command interceptor `beforeExecute` computes tier = `'bronze'`, detects existing = `'platinum'`
3. Returns `{ ok: false, message: 'Cannot downgrade...' }`
4. `CommandBus` throws `CommandInterceptorError`
5. API route returns 422 to client with the message

---

## Integration Tests (Command Interceptors)

### TC-UMES-CI01: Command interceptor `beforeExecute` modifies input (auto-computed tier)

**Type**: API (Playwright)

**Steps**:
1. Create a person via API (baseline)
2. PUT `/api/customers/people/:id` with body including `"cf:loyalty_score": 95`
3. GET the updated person
4. Assert `cf:loyalty_tier` is `'platinum'` (auto-set by interceptor, not by the user)

**Expected**: The interceptor's `modifiedInput` is merged into the command input and persisted

### TC-UMES-CI02: Command interceptor `beforeExecute` blocks execution with 422

**Type**: API (Playwright)

**Steps**:
1. Create a person, set `cf:loyalty_score` to 95 (tier becomes `'platinum'`)
2. PUT to update `cf:loyalty_score` to 30 **without** `cf:tier_change_reason`
3. Assert response status is 422
4. Assert response body contains message about "Cannot downgrade a Platinum customer"
5. GET the person — assert `cf:loyalty_tier` is still `'platinum'` (update was blocked)

**Expected**: Interceptor blocks the downgrade; original data unchanged

### TC-UMES-CI03: Command interceptor `beforeExecute` allows when condition is met

**Type**: API (Playwright)

**Steps**:
1. Create a person, set `cf:loyalty_score` to 95 (tier = `'platinum'`)
2. PUT to update `cf:loyalty_score` to 30 **with** `cf:tier_change_reason: "Customer requested"``
3. Assert response status is 200
4. GET the person — assert `cf:loyalty_tier` is `'bronze'`

**Expected**: Interceptor allows the downgrade when reason is provided; tier recomputed

### TC-UMES-CI04: Command interceptor `afterExecute` receives metadata from `beforeExecute`

**Type**: API (Playwright)

**Steps**:
1. Create a person
2. PUT with `cf:loyalty_score: 75`
3. Verify the update succeeds (200)
4. (Indirect verification: check server logs for the `[example] Customer X upgraded by rule` message, or verify cache was invalidated by checking a subsequent GET is fresh)

**Expected**: `afterExecute` receives `metadata.computedTier` and `metadata.previousScore` from `beforeExecute`

### TC-UMES-CI05: Command interceptor `beforeUndo` blocks undo with message

**Type**: API (Playwright)

**Steps**:
1. Create and update a person (captures undo token)
2. Wait or simulate 25 hours passing (via test helper or adjustable time-limit interceptor)
3. Attempt undo via the undo token
4. Assert undo fails with message about "Cannot undo changes older than 24 hours"

**Expected**: `beforeUndo` interceptor blocks the undo; original update remains

**Testing notes**: For practical testing, use an interceptor with a configurable time limit (e.g., 0 seconds for the test) or mock time.

### TC-UMES-CI06: Command interceptor `afterUndo` runs cleanup after successful undo

**Type**: API (Playwright)

**Steps**:
1. Create a person, update `cf:loyalty_score` to 80 (captures undo token)
2. GET person — verify `cf:loyalty_tier` is `'gold'`
3. Undo the update via token
4. GET person — verify `cf:loyalty_score` and `cf:loyalty_tier` reverted to original values
5. (Indirect verification: `afterUndo` ran, cache invalidated — subsequent reads return fresh data)

**Expected**: Undo restores original values; `afterUndo` runs cleanup

### TC-UMES-CI07: Wildcard `customers.*` interceptor matches all customer commands

**Type**: API (Playwright)

**Steps**:
1. Register an interceptor with `targetCommand: 'customers.*'`
2. Execute `customers.people.update` — verify interceptor runs (e.g., via logged metadata)
3. Execute `customers.companies.update` — verify interceptor runs
4. Execute `example.todos.update` — verify interceptor does NOT run

**Expected**: Wildcard matches all customer module commands but not other modules

### TC-UMES-CI08: Multiple interceptors run in priority order, first rejection wins

**Type**: API (Playwright)

**Steps**:
1. Register interceptor A (priority 10) that allows
2. Register interceptor B (priority 20) that blocks
3. Register interceptor C (priority 30) that allows
4. Execute a command
5. Assert execution is blocked by interceptor B
6. Assert interceptor C's `beforeExecute` was never called

**Expected**: Priority ordering is respected; short-circuits on first `ok: false`

### TC-UMES-CI09: ACL-gated interceptor skipped when user lacks feature

**Type**: API (Playwright)

**Steps**:
1. Register interceptor with `features: ['loyalty.manage']`
2. Execute command as user WITHOUT `loyalty.manage` feature
3. Assert interceptor is skipped (command succeeds normally)
4. Execute command as user WITH `loyalty.manage` feature
5. Assert interceptor runs (modifies input or blocks)

**Expected**: Feature-gated interceptors respect ACL

### TC-UMES-CI10: Interceptor on create command (`customers.people.create`)

**Type**: API (Playwright)

**Steps**:
1. Register interceptor targeting `customers.people.create`
2. POST `/api/customers/people` to create a person with `cf:loyalty_score: 85`
3. GET the created person
4. Assert `cf:loyalty_tier` is `'gold'` (auto-set by interceptor)

**Expected**: Interceptors work on create commands, not just updates

---

## Backward Compatibility

- Existing `crudMutationGuardService` DI token: **auto-bridged** to registry entry with `priority: 0`
- Existing `validateCrudMutationGuard()` / `runCrudMutationGuardAfterSuccess()`: **deprecated** but fully functional
- Existing `CrudHooks.before*` / `CrudHooks.after*`: **unchanged** — same pipeline position
- Existing async subscribers: **unchanged** — `sync` defaults to `false`, no opt-in needed
- Existing event declarations: **unchanged** — before-events auto-derived by factory, not declared
- Existing widget handlers: **unchanged** — new `filter` field is optional
- New `data/guards.ts`: purely additive — modules without it have zero change
- New sync subscribers: purely additive — discovered via existing `subscribers/*.ts` pattern
- New `commands/interceptors.ts`: purely additive — modules without it have zero change
- Existing `CommandHandler` interface: **unchanged** — interceptors wrap the handler, not modify it
- Existing `commandBus.execute()` callers: **unchanged** — interceptor errors throw `CommandInterceptorError` (subclass of `Error`), existing `try/catch` blocks handle it naturally
- Existing `commandBus.undo()` callers: **unchanged** — same error propagation pattern
- DELETE `beforeDelete` ordering: **normalized** to match PUT behavior
- POST (create): **new guard coverage** — guards must handle `resourceId: null`
