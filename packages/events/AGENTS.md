# Events Package — Agent Guidelines

`@open-mercato/events` provides event bus and pub/sub infrastructure.

## Structure

```
packages/events/src/
├── modules/
│   └── events/
│       └── workers/    # Async event processing workers
└── __tests__/
```

## Event Bus Architecture

- Supports local (in-process) and async (Redis-backed) event dispatch
- Modules declare events in `events.ts` using `createModuleEvents()` from `@open-mercato/shared/modules/events`
- Events are auto-discovered by generators → `generated/events.generated.ts`

## Subscription Types

| Type | Persistence | Use Case |
|------|-------------|----------|
| Ephemeral | In-memory only | Real-time UI updates, cache invalidation |
| Persistent | Stored, retried on failure | Notifications, indexing, audit logging |

Subscribers export `metadata` with `{ event: string, persistent?: boolean, id?: string }`.

## Event Declaration

Events must be declared in the emitting module's `events.ts` for type safety and workflow trigger discovery. See `packages/core/AGENTS.md` → Events for the full pattern.

## Workers

Workers in `modules/events/workers/` handle async event processing. They follow the standard worker contract: export default handler + `metadata` with `{ queue, id?, concurrency? }`.

## Integration with Queue Package

When `QUEUE_STRATEGY=async`, persistent events are dispatched through the queue package (BullMQ). When `QUEUE_STRATEGY=local`, they process from the `.queue/` directory.
