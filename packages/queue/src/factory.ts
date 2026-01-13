import type { Queue, LocalQueueOptions, AsyncQueueOptions } from './types'
import { createLocalQueue } from './strategies/local'
import { createAsyncQueue } from './strategies/async'

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
