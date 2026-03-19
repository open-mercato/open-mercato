# Queue Package — Standalone Developer Guide

`@open-mercato/queue` provides background job processing. MUST NOT implement custom job queues or polling loops.

## Strategy Selection

| Strategy | When | Config |
|----------|------|--------|
| Local | Development — processes from `.mercato/queue/` | `QUEUE_STRATEGY=local` |
| BullMQ | Production — Redis-backed with retries | `QUEUE_STRATEGY=async` |

## Adding a Worker

Create `src/modules/<module>/workers/<name>.ts`:

```typescript
export const metadata = {
  queue: 'my-queue',
  id: 'my-worker',
  concurrency: 5,
}

export default async function handler(job) {
  // MUST be idempotent — jobs may be retried on failure
  // Check state before mutating
}
```

Run `yarn generate` after adding.

## Concurrency Guidelines

| Worker type | Concurrency | Rationale |
|-------------|-------------|-----------|
| I/O-bound (API calls, email) | 5–10 | Network latency allows parallelism |
| CPU-bound (calculations) | 1–2 | Avoid blocking event loop |
| Database-heavy (bulk writes) | 3–5 | Balance with connection pool |

Max concurrency: 20.

## MUST Rules

1. **MUST make workers idempotent** — duplicate execution MUST NOT corrupt data
2. **MUST export `metadata`** with `{ queue, id?, concurrency? }`
3. **MUST test with both strategies** (`local` and `async`)

## Running Workers (Production)

```bash
yarn mercato <module> worker <queue-name> --concurrency=5
```

Development: local strategy auto-processes from `.mercato/queue/`.
