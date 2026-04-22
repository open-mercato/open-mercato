/**
 * @open-mercato/queue
 *
 * Multi-strategy job queue package supporting local (file-based) and async (BullMQ) strategies.
 *
 * @example
 * ```typescript
 * import { createQueue } from '@open-mercato/queue'
 *
 * // Create a local queue
 * const queue = createQueue<{ userId: string }>('my-queue', 'local')
 *
 * // Enqueue a job
 * await queue.enqueue({ userId: '123' })
 *
 * // Process jobs
 * await queue.process(async (job, ctx) => {
 *   console.log(`Processing job ${ctx.jobId}:`, job.payload)
 * })
 * ```
 */

export * from './types'
export { createQueue } from './factory'

// Worker utilities
export * from './worker/registry'
export { runWorker, createRoutedHandler } from './worker/runner'
