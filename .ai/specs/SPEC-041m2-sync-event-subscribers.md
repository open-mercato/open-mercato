# SPEC-041m2 — Sync Event Subscribers (Lifecycle Events)

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041m — Mutation Lifecycle](./SPEC-041m-mutation-lifecycle.md) |
| **Status** | Draft |

## Goal

Extend the existing event subscriber system to support **synchronous lifecycle events** that run inside the mutation pipeline. This reuses the existing `subscribers/*.ts` auto-discovery and event ID filtering.

---

## Lifecycle Event Naming Convention

The CRUD factory auto-derives **before-events** from existing event config using present continuous tense:

| Existing After-Event (past tense) | Auto-Derived Before-Event (present continuous) |
|-----------------------------------|-------------------------------------------------|
| `customers.person.created` | `customers.person.creating` |
| `customers.person.updated` | `customers.person.updating` |
| `customers.person.deleted` | `customers.person.deleting` |
| `example.todo.created` | `example.todo.creating` |
| `sales.order.updated` | `sales.order.updating` |

**Rule**: Before-event IDs are NOT declared in `events.ts`. They are auto-derived by the CRUD factory from the existing event config: `{module}.{entity}.created` → `{module}.{entity}.creating`. This keeps `events.ts` clean — modules only declare the after-events they already have.

---

## Extended Subscriber Metadata

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

---

## Sync Subscriber Handler Contract

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

---

## Sync Event Runner

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

---

## Event Pattern Matching

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

---

## Bootstrap: Sync Subscriber Registry

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

---

## Examples

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

---

## Integration Tests

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

### TC-UMES-ML10: Cross-module sync subscriber (example subscribing to customers.person.updating)

**Type**: API (Playwright)

**Steps**:
1. Update a customer person with invalid email
2. Assert 422 from the example module's sync subscriber
3. Update with valid email — success, email normalized to lowercase

---

## Backward Compatibility

- Async subscribers (`sync: false`, which is the default) are completely unchanged. They continue to fire via the event bus after the mutation, as today. The `sync` metadata flag defaults to `false` — existing subscribers never opt in.
- Existing event declarations (`events.ts`) unchanged — before-events auto-derived by factory, not declared.

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/lib/crud/sync-event-types.ts` |
| **NEW** | `packages/shared/src/lib/crud/sync-event-runner.ts` |
| **NEW** | `packages/core/src/modules/example/subscribers/auto-default-priority.ts` |
| **NEW** | `packages/core/src/modules/example/subscribers/prevent-uncomplete.ts` |
| **NEW** | `packages/core/src/modules/example/subscribers/audit-delete.ts` |
| **MODIFY** | `packages/shared/src/lib/crud/factory.ts` (add sync event emission to POST/PUT/DELETE) |
| **MODIFY** | Bootstrap registration (split sync/async subscribers) |
