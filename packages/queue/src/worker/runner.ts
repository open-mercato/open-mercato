import { createQueue } from '../factory'
import type { Queue, JobHandler, AsyncQueueOptions, QueueStrategyType } from '../types'

/**
 * Options for running a queue worker.
 */
export type WorkerRunnerOptions<T = unknown> = {
  /** Name of the queue to process */
  queueName: string
  /** Handler function to process each job */
  handler: JobHandler<T>
  /** Redis connection options (only used for async strategy) */
  connection?: AsyncQueueOptions['connection']
  /** Number of concurrent jobs to process */
  concurrency?: number
  /** Whether to set up graceful shutdown handlers */
  gracefulShutdown?: boolean
  /** If true, don't block - return immediately after starting processing (for multi-queue mode) */
  background?: boolean
  /** Queue strategy to use. Defaults to QUEUE_STRATEGY env var or 'local' */
  strategy?: QueueStrategyType
}

const managedQueues = new Set<Queue<unknown>>()
let shutdownHandlersRegistered = false
let shutdownInProgress = false

function unregisterShutdownHandlers(sigtermHandler: () => void, sigintHandler: () => void): void {
  process.off('SIGTERM', sigtermHandler)
  process.off('SIGINT', sigintHandler)
  shutdownHandlersRegistered = false
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return

  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return
    shutdownInProgress = true

    console.log(`[worker] Received ${signal}, shutting down gracefully...`)

    let hasError = false
    for (const queue of managedQueues) {
      try {
        await queue.close()
      } catch (error) {
        hasError = true
        console.error('[worker] Error during shutdown:', error)
      }
    }

    managedQueues.clear()
    unregisterShutdownHandlers(sigtermHandler, sigintHandler)
    shutdownInProgress = false

    if (!hasError) {
      console.log('[worker] Worker closed successfully')
    }

    process.exit(hasError ? 1 : 0)
  }

  const sigtermHandler = () => {
    void shutdown('SIGTERM')
  }

  const sigintHandler = () => {
    void shutdown('SIGINT')
  }

  process.on('SIGTERM', sigtermHandler)
  process.on('SIGINT', sigintHandler)
  shutdownHandlersRegistered = true
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
    strategy: strategyOption,
  } = options

  // Determine queue strategy from option, env var, or default to 'local'
  const strategy: QueueStrategyType = strategyOption
    ?? (process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local')

  console.log(`[worker] Starting worker for queue "${queueName}" (strategy: ${strategy})...`)

  const queue = createQueue<T>(queueName, strategy, {
    connection,
    concurrency,
  })

  // Set up graceful shutdown
  if (gracefulShutdown) {
    managedQueues.add(queue as Queue<unknown>)
    registerShutdownHandlers()
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
