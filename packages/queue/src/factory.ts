import type { Queue, LocalQueueOptions, AsyncQueueOptions, QueueStrategyType } from './types'
import { createLocalQueue } from './strategies/local'
import { createAsyncQueue } from './strategies/async'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'

/**
 * Creates a queue instance with the specified strategy.
 *
 * @template T - The payload type for jobs in this queue
 * @param name - Unique name for the queue
 * @param strategy - Queue strategy: 'local' for file-based, 'async' for BullMQ
 * @param options - Strategy-specific options
 * @returns A Queue instance
 *
 * @example
 * ```typescript
 * // Local file-based queue
 * const localQueue = createQueue<MyJobData>('my-queue', 'local')
 *
 * // BullMQ-based queue
 * const asyncQueue = createQueue<MyJobData>('my-queue', 'async', {
 *   connection: { url: 'redis://localhost:6379' },
 *   concurrency: 5
 * })
 * ```
 */
export function createQueue<T = unknown>(
  name: string,
  strategy: 'local',
  options?: LocalQueueOptions
): Queue<T>

export function createQueue<T = unknown>(
  name: string,
  strategy: 'async',
  options?: AsyncQueueOptions
): Queue<T>

// General overload for dynamic strategy (union type)
export function createQueue<T = unknown>(
  name: string,
  strategy: 'local' | 'async',
  options?: LocalQueueOptions | AsyncQueueOptions
): Queue<T>

export function createQueue<T = unknown>(
  name: string,
  strategy: 'local' | 'async',
  options?: LocalQueueOptions | AsyncQueueOptions
): Queue<T> {
  if (strategy === 'async') {
    return createAsyncQueue<T>(name, options as AsyncQueueOptions)
  }

  return createLocalQueue<T>(name, options as LocalQueueOptions)
}

/**
 * Resolve the queue strategy from `QUEUE_STRATEGY`. Defaults to `'local'`.
 */
export function resolveQueueStrategy(): QueueStrategyType {
  return process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
}

/**
 * Create a module-owned queue using the strategy declared in `QUEUE_STRATEGY`.
 *
 * - When `QUEUE_STRATEGY=async`, builds a BullMQ queue and resolves the
 *   Redis URL via `getRedisUrlOrThrow('QUEUE')` so missing config fails loudly.
 * - Otherwise builds a local file-based queue.
 *
 * Replaces the boilerplate `process.env.QUEUE_STRATEGY === 'async' ? ... : ...`
 * pattern that every module queue helper used to repeat. Concurrency applies
 * to both strategies so the same number means the same thing in dev and prod.
 *
 * @example
 * ```typescript
 * export function getDataSyncQueue(name: string) {
 *   return createModuleQueue<MyJob>(name, { concurrency: 5 })
 * }
 * ```
 */
export function createModuleQueue<T = unknown>(
  name: string,
  options?: { concurrency?: number },
): Queue<T> {
  const strategy = resolveQueueStrategy()
  if (strategy === 'async') {
    return createAsyncQueue<T>(name, {
      connection: { url: getRedisUrlOrThrow('QUEUE') },
      concurrency: options?.concurrency,
    })
  }
  return createLocalQueue<T>(name, { concurrency: options?.concurrency })
}
