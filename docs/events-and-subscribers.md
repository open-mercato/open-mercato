# Events & Subscribers

This adds a Medusa-style event/subscriber system with module auto-discovery, DI integration, and offline processing via local JSON or Redis.

## Overview

- Subscribers live under `src/modules/<module>/subscribers/*.ts` and export:
  - `export const metadata = { event: string, persistent?: boolean, id?: string }`
  - `export default async function(payload, ctx) { /* ... */ }`
    - `ctx.resolve(name)` resolves services from Awilix per-request container.
- Subscribers discovered at build via `modules:prepare` and registered into a global Event Bus via the core bootstrap (`@mercato-core/bootstrap`), which your app calls from `src/di.ts`.
- Emit events programmatically via `eventBus.emitEvent(event, payload, { persistent? })`.
- Two strategies:
  - Local: online delivery + optional persistence to `.events/queue.json` with state in `.events/state.json`.
  - Redis: online delivery + persistence in Redis sorted set.
- Offline processing: `npm run mercato events process -- [--limit=N]` replays unprocessed persistent events.

## File Structure

Example subscriber file `src/modules/example/subscribers/order-created.ts`:

```
export const metadata = {
  event: 'order.created',
  persistent: true, // optional, default false
}

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve('em')
  // ... do something with payload using DI services
}
```

IDs are optional; default is `"<module>:<nested_path>"`.

## Emitting Events

From any handler with DI access:

```
const bus = container.resolve('eventBus')
await bus.emitEvent('order.created', { id: 123, total: 42 }, { persistent: true })
```

## Programmatic Registration

Modules can register subscribers in `di.ts`:

```
import type { AppContainer } from '@/lib/di/container'

export function register(container: AppContainer) {
  const bus = container.resolve<any>('eventBus')
  bus.on('custom.event', async (payload, ctx) => {
    const em = ctx.resolve('em')
    // ...
  })
}
```

## Strategy & Persistence

- Select strategy via `EVENTS_STRATEGY=local|redis` (default `local`).
- Redis URL taken from `REDIS_URL` or `EVENTS_REDIS_URL`.
- Persistent events are recorded and can be replayed later.
  - Local: `.events/queue.json` and `.events/state.json` in project root.
  - Redis: keys `events:last_id`, `events:queue` (sorted set), `events:last_processed_id`.

## Offline Processing

Process queued events since last processed id:

```
npm run mercato events process -- --limit=500
```

The process uses the DI container, so subscriber handlers can resolve services.

Clear queues:

```
# Remove all queued events (persistent storage)
npm run mercato events clear

# Remove only events already processed (based on last processed id)
npm run mercato events clear-processed
```

## Notes

- Subscribers are executed online on `emitEvent`, and also available for offline replay when persistent.
- Input validation and security remain the responsibility of the emitting producer/consumer code.
