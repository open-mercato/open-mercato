# Queue Package — Agent Guidelines

`@open-mercato/queue` provides multi-strategy job queues.

## Structure

```
packages/queue/src/
├── strategies/    # Local file-based, BullMQ implementations
├── worker/        # Worker runner infrastructure
└── __tests__/
```

## Strategies

| Strategy | Configuration | Use Case |
|----------|---------------|----------|
| Local | `QUEUE_STRATEGY=local` | Development — jobs processed from `.queue/` directory |
| BullMQ | `QUEUE_STRATEGY=async` | Production — Redis-backed with retries and concurrency |

## Worker Contract

Module workers export default handler + `metadata`:

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

## Concurrency

Configure per-worker via `metadata.concurrency`. Default varies by worker type. Keep concurrency appropriate for the task (I/O-bound vs CPU-bound).
