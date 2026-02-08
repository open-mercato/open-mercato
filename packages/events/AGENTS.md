# Events Package — Agent Guidelines

Use `@open-mercato/events` for all event-driven communication between modules. MUST NOT use direct module-to-module function calls for side effects.

## MUST Rules

1. **MUST declare events in the emitting module's `events.ts`** — use `createModuleEvents()` with `as const` for type safety
2. **MUST run `npm run modules:prepare`** after creating or modifying `events.ts` files
3. **MUST NOT emit undeclared events** — undeclared events trigger TypeScript errors and runtime warnings
4. **MUST export `metadata`** from every subscriber with `{ event, persistent?, id? }`
5. **MUST keep subscribers focused** — one side effect per subscriber file

## Event Declaration

Declare events in the emitting module's `events.ts`:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'module.entity.created', label: 'Entity Created', entity: 'entity', category: 'crud' },
  { id: 'module.entity.updated', label: 'Entity Updated', entity: 'entity', category: 'crud' },
  { id: 'module.entity.deleted', label: 'Entity Deleted', entity: 'entity', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'module', events })
export const emitModuleEvent = eventsConfig.emit
export default eventsConfig
```

See `packages/core/AGENTS.md` → Events for the full pattern.

## Subscription Types

| Type | When to use | Persistence |
|------|-------------|-------------|
| Ephemeral | Use for real-time UI updates, cache invalidation | In-memory only — lost on restart |
| Persistent | Use for notifications, indexing, audit logging | Stored and retried on failure |

## Adding an Event Subscriber

1. Create subscriber file in `src/modules/<module>/subscribers/<event-name>.ts`
2. Export `metadata` with `{ event: 'module.entity.created', persistent: true, id: 'my-subscriber' }`
3. Export default async handler function
4. Keep the handler focused on one side effect
5. Run `npm run modules:prepare` to register the subscriber
6. Test that the subscriber fires correctly after the event is emitted

### Subscriber Contract

```typescript
export const metadata = { event: 'module.entity.created', persistent: true, id: 'entity-created-notify' }
export default async function handler(payload, ctx) { /* ... */ }
```

## Event Bus Architecture

- Supports local (in-process) and async (Redis-backed) event dispatch
- Events are auto-discovered by generators → `generated/events.generated.ts`
- When `QUEUE_STRATEGY=async`, persistent events dispatch through the queue package (BullMQ)
- When `QUEUE_STRATEGY=local`, persistent events process from the `.queue/` directory

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
