import { createModuleQueue, type Queue } from '@open-mercato/queue'

// SPEC-055 §Implementation Plan Phase 3 Step 5 / Release 4 PLAN.md Step 6.4 — hyphenated
// queue-name convention (rev — W-low, "promotions-code-generate"). Mirrors
// `catalog/lib/catalogQueue.ts`'s per-name cache so this module's own code-generation
// worker (and, per Step 6.5, the code-reservation sweeper) can share one lazy
// queue-instance map keyed by queue name rather than each hand-rolling its own.

export const PROMOTIONS_CODE_GENERATE_QUEUE = 'promotions-code-generate'

// Step 6.5 — the reservation sweeper's own queue (SPEC-055 "X7" / §Implementation Plan
// Phase 3 Step 7). Same hyphenated-name convention as the generate queue above.
export const PROMOTIONS_CODE_RESERVATION_SWEEP_QUEUE = 'promotions-code-reservation-sweep'

const queues = new Map<string, Queue<any>>()

export function getPromotionsQueue<T = Record<string, unknown>>(queueName: string): Queue<T> {
  const existing = queues.get(queueName)
  if (existing) return existing as Queue<T>

  // Code generation is CPU-bound (string generation + batched inserts), not I/O-bound —
  // `packages/queue/AGENTS.md`'s own concurrency table recommends 1-2 for that profile.
  const concurrency = Math.max(1, Number.parseInt(process.env.PROMOTIONS_QUEUE_CONCURRENCY ?? '2', 10) || 2)
  const created = createModuleQueue<T>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}
