# Events Package — Agent Guidelines

Use `@open-mercato/events` for all event-driven communication between modules. MUST NOT use direct module-to-module function calls for side effects.

## Always

1. **MUST declare events in the emitting module's `events.ts`** — use `createModuleEvents()` with `as const` for type safety
2. **MUST run `yarn generate`** after creating or modifying `events.ts` files
3. **MUST export `metadata`** from every subscriber with `{ event, persistent?, id? }`
4. **MUST keep subscribers focused** — one side effect per subscriber file
5. **MUST make persistent subscribers idempotent** — they may be retried on failure

## Ask First

- Ask before renaming event IDs, changing persistent delivery semantics, or altering SSE audience filtering.
- Ask before increasing SSE payload size limits or heartbeat/deduplication behavior.

## Never

- Never use direct module-to-module function calls for side effects.
- Never emit undeclared events — undeclared events trigger TypeScript errors and runtime warnings.
- Never rely on payload-provided tenant or organization scope when trusted scope is available.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/events test
yarn workspace @open-mercato/events build
```

## Event Declaration

Declare events in the emitting module's `events.ts`. See `packages/core/AGENTS.md` → Events for the full declaration pattern, field reference (`id`, `label`, `category`, `entity`, `excludeFromTriggers`), and code example.

Quick reference:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'
const events = [
  { id: 'module.entity.created', label: 'Entity Created', entity: 'entity', category: 'crud' },
] as const
export const eventsConfig = createModuleEvents({ moduleId: 'module', events })
export default eventsConfig
```

## Subscription Types

| Type | When to use | Persistence | Retry behavior |
|------|-------------|-------------|----------------|
| Ephemeral | Use for real-time UI updates, cache invalidation | In-memory only — lost on restart | No retry |
| Persistent | Use for notifications, indexing, audit logging | Stored in queue — survives restarts | Retried on failure |

## Adding an Event Subscriber

1. Create subscriber file in `src/modules/<module>/subscribers/<event-name>.ts`
2. Export `metadata` with `{ event: 'module.entity.created', persistent: true, id: 'my-subscriber' }`
3. Export default async handler function
4. Keep the handler focused on one side effect
5. Make the handler idempotent if `persistent: true` — it may be retried
6. Run `yarn generate` to register the subscriber
7. Test that the subscriber fires correctly after the event is emitted

### Subscriber Contract

```typescript
export const metadata = { event: 'module.entity.created', persistent: true, id: 'entity-created-notify' }
export default async function handler(payload, ctx) { /* ... */ }
```

## Event Bus Architecture

- Supports local (in-process) and async (Redis-backed) event dispatch
- Events are auto-discovered by generators → `generated/events.generated.ts`
- When `QUEUE_STRATEGY=async`, persistent events dispatch through the queue package (BullMQ)
- When `QUEUE_STRATEGY=local`, persistent events process from `.mercato/queue/` (or `QUEUE_BASE_DIR`)
- Ephemeral subscribers always run in-process regardless of queue strategy

### Persistent delivery: legacy vs single-delivery (`OM_EVENTS_SINGLE_DELIVERY`)

By default (`OM_EVENTS_SINGLE_DELIVERY` unset/false) a persistent emit is delivered on **both** paths: inline to every matching in-memory subscriber **and** through the events worker (exact-match). This double-dispatches exact-match subscribers and never reaches wildcard (`event: '*'`) persistent subscribers in the worker.

Set `OM_EVENTS_SINGLE_DELIVERY=true` to make persistent delivery single-path:
- the bus skips inline delivery of **persistent-marked** subscribers on a persistent emit (ephemeral subscribers still run inline);
- the events worker dispatches **persistent** subscribers via `matchEventPattern`, so wildcard persistent subscribers are finally reached.

Both halves are gated by the same flag and MUST move together. When enabling it, ensure the events worker runs (default `AUTO_SPAWN_WORKERS=true`) and validate under both `QUEUE_STRATEGY=local` and `=async` so no persistent subscriber is dropped. This is the "Ask First: changing persistent delivery semantics" gate — the flag defaults off to preserve today's behavior.

## Queue Integration

| Queue strategy | Ephemeral events | Persistent events |
|----------------|------------------|-------------------|
| `local` | In-process | Processed from `.mercato/queue/` (or `QUEUE_BASE_DIR`) |
| `async` | In-process | Dispatched via BullMQ (Redis-backed) |

When `QUEUE_STRATEGY=async`, persistent event workers run as background processes. Start them with:

```bash
yarn mercato events worker event-processing --concurrency=5
```

## Structure

```
packages/events/src/
├── modules/
│   └── events/
│       └── workers/    # Async event processing workers
└── __tests__/
```

## Workers

Workers in `modules/events/workers/` handle async event processing. Follow the standard worker contract: export default handler + `metadata` with `{ queue, id?, concurrency? }`.

## Testing

- Tests inside `packages/events` SHOULD import the public `@open-mercato/events/...` API when validating package behavior
- `tenantId` and `organizationId` in subscriber context are trusted scope inputs from `emit(..., options)` or queued job `options`, not from arbitrary payload fields
- Add regression tests for both paths:
  - trusted scope is forwarded when explicitly provided
  - payload-provided scope is ignored when trusted scope is omitted

## Cross-Reference

- **Declaring events in a module**: `packages/core/AGENTS.md` → Events
- **Adding subscribers in a module**: `packages/core/AGENTS.md` → Events → Event Subscribers
- **Queue worker contract**: `packages/queue/AGENTS.md`

## DOM Event Bridge (SSE)

The DOM Event Bridge streams server-side events to the browser via Server-Sent Events (SSE).

### How It Works

1. Module declares events with `clientBroadcast: true` in `events.ts`
2. SSE endpoint at `/api/events/stream` subscribes to the event bus
3. Client-side `eventBridge.ts` connects via `EventSource` with auto-reconnect
4. Events are dispatched as `om:event` CustomEvents on `window`
5. Widgets/components listen via `useAppEvent(pattern, handler)` hook

### Enabling Broadcast on Events

In your module's `events.ts`:
```typescript
const events = [
  { id: 'mymod.entity.created', label: 'Created', category: 'crud', clientBroadcast: true },
] as const
```

### Consuming Events in Components

```typescript
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

// Wildcard: listen to all events from a module
useAppEvent('mymod.*', (event) => {
  console.log(event.id, event.payload)
}, [])

// Exact match
useAppEvent('mymod.entity.created', (event) => {
  // refresh data
}, [])
```

### Browser Delivery Rules

- Events are server-filtered by audience before SSE send:
  - Tenant: `tenantId` must match
  - Organization: `organizationId` or `organizationIds` must match selected organization
  - Recipient user: `recipientUserId` or `recipientUserIds` must include connection user
  - Recipient role: `recipientRoleId` or `recipientRoleIds` must intersect connection roles
- Missing `tenantId` in event payload means no delivery
- SSE sends heartbeats every 30s; client auto-reconnects if no heartbeat within 45s
- Max payload size is 4096 bytes per event
- Client deduplicates events within a 500ms window
- `isBroadcastEvent(eventId)` checks if an event has `clientBroadcast: true`
- The `useEventBridge()` hook must be mounted once in the app shell to start receiving events
