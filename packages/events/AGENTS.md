# Events Package — Agent Guidelines

Use `@open-mercato/events` for all event-driven communication between modules. MUST NOT use direct module-to-module function calls for side effects.

## MUST Rules

1. **MUST declare events in the emitting module's `events.ts`** — use `createModuleEvents()` with `as const` for type safety
2. **MUST run `npm run modules:prepare`** after creating or modifying `events.ts` files
3. **MUST NOT emit undeclared events** — undeclared events trigger TypeScript errors and runtime warnings
4. **MUST export `metadata`** from every subscriber with `{ event, persistent?, id? }`
5. **MUST keep subscribers focused** — one side effect per subscriber file
6. **MUST make persistent subscribers idempotent** — they may be retried on failure

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
6. Run `npm run modules:prepare` to register the subscriber
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

## Cross-Reference

- **Declaring events in a module**: `packages/core/AGENTS.md` → Events
- **Adding subscribers in a module**: `packages/core/AGENTS.md` → Events → Event Subscribers
- **Queue worker contract**: `packages/queue/AGENTS.md`
