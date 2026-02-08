# Queue Package — Agent Guidelines

Use `@open-mercato/queue` for all background job processing. MUST NOT implement custom job queues or polling loops.

## Strategy Selection

| Strategy | When to use | Configuration |
|----------|-------------|---------------|
| Local | Use for development — jobs process from `.queue/` directory | `QUEUE_STRATEGY=local` |
| BullMQ | Use for production — Redis-backed with retries and concurrency | `QUEUE_STRATEGY=async` |

## MUST Rules

1. **MUST make workers idempotent** — jobs may be retried on failure; duplicate execution MUST NOT corrupt data
2. **MUST export `metadata`** with `{ queue, id?, concurrency? }` from every worker file
3. **MUST NOT exceed concurrency 20** — keep concurrency appropriate for the task type
4. **MUST test with both strategies** — verify workers process correctly with `local` and `async`

## Concurrency Guidelines

| Worker type | Recommended concurrency | Rationale |
|-------------|------------------------|-----------|
| I/O-bound (API calls, email) | 5–10 | Network latency allows parallelism |
| CPU-bound (calculations, parsing) | 1–2 | Avoid blocking the event loop |
| Database-heavy (bulk writes) | 3–5 | Balance throughput with connection pool |

## Adding a New Worker

1. Create worker file in `src/modules/<module>/workers/<worker-name>.ts`
2. Export `metadata` with `{ queue: '<queue-name>', id: '<worker-id>', concurrency: <n> }`
3. Export default async handler function
4. Ensure handler is idempotent — check state before mutating
5. Run `npm run modules:prepare` to register the worker
6. Test with `QUEUE_STRATEGY=local` in development

### Worker Contract

```typescript
export const metadata = { queue: 'my-queue', id: 'my-worker', concurrency: 5 }
export default async function handler(job) { /* ... */ }
```

## Running Workers

```bash
# Start a specific worker (production)
yarn mercato <module> worker <queue-name> --concurrency=5

# Development: local strategy auto-processes from .queue/
```

## Structure

```
packages/queue/src/
├── strategies/    # Local file-based, BullMQ implementations
├── worker/        # Worker runner infrastructure
└── __tests__/
```
