# Queue Package — Agent Guidelines

Use `@open-mercato/queue` for all background job processing. MUST NOT implement custom job queues or polling loops.

## Strategy Selection

| Strategy | When to use | Configuration |
|----------|-------------|---------------|
| Local | Use for development — jobs process from `.mercato/queue/` (or `QUEUE_BASE_DIR`) | `QUEUE_STRATEGY=local` |
| BullMQ | Use for production — Redis-backed with retries and concurrency | `QUEUE_STRATEGY=async` |

## Always

1. **MUST make workers idempotent** — jobs may be retried on failure; duplicate execution MUST NOT corrupt data
2. **MUST export `metadata`** with `{ queue, id?, concurrency? }` from every worker file
3. **MUST test with both strategies** — verify workers process correctly with `local` and `async`

## Ask First

- Ask before changing queue strategy defaults, retry semantics, or worker concurrency limits.
- Ask before adding a polling loop or long-running process outside the queue worker contract.

## Never

- Never implement custom job queues or polling loops.
- Never exceed worker concurrency 20.
- Never make a worker depend on single-run semantics.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/queue test
yarn workspace @open-mercato/queue build
```

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
5. Run `yarn generate` to register the worker
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

# Development: local strategy auto-processes from .mercato/queue/
```

## Structure

```
packages/queue/src/
├── strategies/    # Local file-based, BullMQ implementations
├── worker/        # Worker runner infrastructure
└── __tests__/
```
