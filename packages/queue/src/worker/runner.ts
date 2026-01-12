import { createQueue } from '../factory'
import type { JobHandler, AsyncQueueOptions } from '../types'

/**
 * Options for running a queue worker.
 */
export type WorkerRunnerOptions<T = unknown> = {
  /** Name of the queue to process */
  queueName: string
  /** Handler function to process each job */
  handler: JobHandler<T>
  /** Redis connection options */
  connection?: AsyncQueueOptions['connection']
  /** Number of concurrent jobs to process */
  concurrency?: number
  /** Whether to set up graceful shutdown handlers */
  gracefulShutdown?: boolean
  /** If true, don't block - return immediately after starting processing (for multi-queue mode) */
  background?: boolean
}

/**
 * Runs a queue worker that processes jobs continuously.
 *
 * This function:
 * 1. Creates an async queue instance
 * 2. Starts a BullMQ worker
 * 3. Sets up graceful shutdown on SIGTERM/SIGINT
 * 4. Keeps the process running until shutdown
 *
 * @template T - The job payload type
 * @param options - Worker configuration
 *
 * @example
 * ```typescript
 * import { runWorker } from '@open-mercato/queue/worker'
 *
 * await runWorker({
 *   queueName: 'events',
 *   handler: async (job, ctx) => {
 *     console.log(`Processing ${ctx.jobId}:`, job.payload)
 *   },
 *   connection: { url: process.env.REDIS_URL },
 *   concurrency: 5,
 * })
 * ```
 */
export async function runWorker<T = unknown>(
  options: WorkerRunnerOptions<T>
): Promise<void> {
  const {
    queueName,
    handler,
    connection,
    concurrency = 1,
    gracefulShutdown = true,
    background = false,
  } = options

  console.log(`[worker] Starting worker for queue "${queueName}"...`)

  const queue = createQueue<T>(queueName, 'async', {
    connection,
    concurrency,
  })

  // Set up graceful shutdown
  if (gracefulShutdown) {
    const shutdown = async (signal: string) => {
      console.log(`[worker] Received ${signal}, shutting down gracefully...`)
      try {
        await queue.close()
        console.log('[worker] Worker closed successfully')
        process.exit(0)
      } catch (error) {
        console.error('[worker] Error during shutdown:', error)
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  }

  // Start processing
  await queue.process(handler)

  console.log(`[worker] Worker running with concurrency ${concurrency}`)

  if (background) {
    // Return immediately for multi-queue mode
    return
  }

  console.log('[worker] Press Ctrl+C to stop')

  // Keep the process alive (single-queue mode)
  await new Promise(() => {
    // This promise never resolves, keeping the worker running
  })
}

/**
 * Creates a worker handler that routes jobs to specific handlers based on job type.
 *
 * @template T - Base job payload type (must include a 'type' field)
 * @param handlers - Map of job types to their handlers
 *
 * @example
 * ```typescript
 * const handler = createRoutedHandler({
 *   'user.created': async (job) => { ... },
 *   'order.placed': async (job) => { ... },
 * })
 *
 * await runWorker({ queueName: 'events', handler })
 * ```
 */
export function createRoutedHandler<T extends { type: string }>(
  handlers: Record<string, JobHandler<T>>
): JobHandler<T> {
  return async (job, ctx) => {
    const type = job.payload.type
    const handler = handlers[type]

    if (!handler) {
      console.warn(`[worker] No handler registered for job type "${type}"`)
      return
    }

    await handler(job, ctx)
  }
}
