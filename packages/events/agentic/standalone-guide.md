# Events Package — Standalone Developer Guide

`@open-mercato/events` provides event-driven communication between modules. Use events for side effects — never direct module-to-module function calls.

## Declaring Events

Every module that emits events MUST declare them in `events.ts`:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'my_mod.item.created', label: 'Item Created', entity: 'item', category: 'crud' },
  { id: 'my_mod.item.updated', label: 'Item Updated', entity: 'item', category: 'crud' },
  { id: 'my_mod.item.deleted', label: 'Item Deleted', entity: 'item', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'my_mod', events })
export const emitMyModEvent = eventsConfig.emit
export default eventsConfig
```

MUST use `as const` — provides compile-time safety. Run `yarn generate` after adding.

### Event ID Convention

Format: `module.entity.action` (singular entity, past tense action, dots as separators).

## Adding Subscribers

Create subscriber files in `src/modules/<module>/subscribers/`:

```typescript
// subscribers/item-created-notify.ts
export const metadata = {
  event: 'my_mod.item.created',
  persistent: true,    // survives restarts, retried on failure
  id: 'item-created-notify',
}

export default async function handler(payload, ctx) {
  // One side effect per subscriber
}
```

Run `yarn generate` after adding.

## Subscription Types

| Type | Use for | Behavior |
|------|---------|----------|
| Ephemeral (`persistent: false`) | Real-time UI updates, cache invalidation | In-memory, no retry, lost on restart |
| Persistent (`persistent: true`) | Notifications, indexing, audit logging | Queue-backed, retried on failure |

Persistent subscribers MUST be idempotent — they may be retried.

## DOM Event Bridge (Browser Events via SSE)

Stream server-side events to the browser for real-time UI updates.

### Enable on Events

Add `clientBroadcast: true` to event declarations:

```typescript
const events = [
  { id: 'my_mod.item.created', label: 'Created', category: 'crud', clientBroadcast: true },
] as const
```

### Consume in Components

```typescript
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

// Wildcard: all events from a module
useAppEvent('my_mod.*', (event) => {
  // event.id, event.payload — refresh data, show notification
}, [])

// Exact match
useAppEvent('my_mod.item.created', (event) => {
  reloadItems()
}, [reloadItems])
```

### Track Long-Running Operations

```typescript
import { useOperationProgress } from '@open-mercato/ui/backend/injection/useOperationProgress'

const progress = useOperationProgress('my_mod.import.*')
// progress.status: 'idle' | 'running' | 'completed' | 'failed'
// progress.progress: 0-100
```

### SSE Audience Filtering

Events are server-filtered before SSE delivery by:
- `tenantId` (must match)
- `organizationId` / `organizationIds` (must match selected org)
- `recipientUserId` / `recipientUserIds` (must include user)
- `recipientRoleId` / `recipientRoleIds` (must intersect roles)

Missing `tenantId` in payload = no delivery.

## Queue Integration

| Queue strategy | Ephemeral | Persistent |
|----------------|-----------|------------|
| `local` (dev) | In-process | `.mercato/queue/` filesystem |
| `async` (prod) | In-process | BullMQ (Redis-backed) |

For production, start the event worker:
```bash
yarn mercato events worker event-processing --concurrency=5
```
