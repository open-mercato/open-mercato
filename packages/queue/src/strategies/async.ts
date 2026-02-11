import type { Queue, QueuedJob, JobHandler, AsyncQueueOptions, ProcessResult } from '../types'
import { getRedisUrl, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'

// BullMQ interface types - we define the shape we use to maintain type safety
// while keeping bullmq as an optional peer dependency
type ConnectionOptions = { host?: string; port?: number; password?: string; db?: number } | string

interface BullQueueInterface<T> {
  add: (name: string, data: T, opts?: { removeOnComplete?: boolean; removeOnFail?: number }) => Promise<{ id?: string }>
  obliterate: (opts?: { force?: boolean }) => Promise<void>
  close: () => Promise<void>
  getJobCounts: (...states: string[]) => Promise<Record<string, number>>
}

interface BullWorkerInterface {
  on: (event: string, handler: (...args: unknown[]) => void) => void
  close: () => Promise<void>
}

interface BullMQModule {
  Queue: new <T>(name: string, opts: { connection: ConnectionOptions }) => BullQueueInterface<T>
  Worker: new <T>(
    name: string,
    processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
    opts: { connection: ConnectionOptions; concurrency: number }
  ) => BullWorkerInterface
}

/**
 * Resolves Redis connection options from various sources.
 */
function resolveConnection(options?: AsyncQueueOptions['connection']): ConnectionOptions {
  // Priority: explicit options > shared env helper
  if (options?.url) {
    return options.url
  }

  if (options?.host) {
    return {
      host: options.host,
      port: options.port ?? 6379,
      password: options.password,
    }
  }

  // Delegate env var resolution to the shared helper
  const url = getRedisUrl('QUEUE')
  return parseRedisUrl(url)
}

/**
 * Creates a BullMQ-based async queue.
 *
 * This strategy provides:
 * - Persistent job storage in Redis
 * - Automatic retries with exponential backoff
 * - Concurrent job processing
 * - Job prioritization and scheduling
 *
 * @template T - The payload type for jobs
 * @param name - Queue name
 * @param options - Async queue options
 */
export function createAsyncQueue<T = unknown>(
  name: string,
  options?: AsyncQueueOptions
): Queue<T> {
  const connection = resolveConnection(options?.connection)
  const concurrency = options?.concurrency ?? 1

  let bullQueue: BullQueueInterface<QueuedJob<T>> | null = null
  let bullWorker: BullWorkerInterface | null = null
  let bullmqModule: BullMQModule | null = null

  // -------------------------------------------------------------------------
  // Lazy BullMQ initialization
  // -------------------------------------------------------------------------

  async function getBullMQ(): Promise<BullMQModule> {
    if (!bullmqModule) {
      try {
        bullmqModule = await import('bullmq') as unknown as BullMQModule
      } catch {
        throw new Error(
          'BullMQ is required for async queue strategy. Install it with: npm install bullmq'
        )
      }
    }
    return bullmqModule
  }

  async function getQueue(): Promise<BullQueueInterface<QueuedJob<T>>> {
    if (!bullQueue) {
      const { Queue: BullQueueClass } = await getBullMQ()
      bullQueue = new BullQueueClass<QueuedJob<T>>(name, { connection })
    }
    return bullQueue
  }

  // -------------------------------------------------------------------------
  // Queue Implementation
  // -------------------------------------------------------------------------

  async function enqueue(data: T): Promise<string> {
    const queue = await getQueue()
    const jobData: QueuedJob<T> = {
      id: crypto.randomUUID(),
      payload: data,
      createdAt: new Date().toISOString(),
    }

    const job = await queue.add(jobData.id, jobData, {
      removeOnComplete: true,
      removeOnFail: 1000, // Keep last 1000 failed jobs
    })

    return job.id ?? jobData.id
  }

  async function process(handler: JobHandler<T>): Promise<ProcessResult> {
    const { Worker } = await getBullMQ()

    // Create worker that processes jobs
    bullWorker = new Worker<QueuedJob<T>>(
      name,
      async (job) => {
        const jobData = job.data
        await handler(jobData, {
          jobId: job.id ?? jobData.id,
          attemptNumber: job.attemptsMade + 1,
          queueName: name,
        })
      },
      {
        connection,
        concurrency,
      }
    )

    // Set up event handlers
    bullWorker.on('completed', (job) => {
      const jobWithId = job as { id?: string }
      console.log(`[queue:${name}] Job ${jobWithId.id} completed`)
    })

    bullWorker.on('failed', (job, err) => {
      const jobWithId = job as { id?: string } | undefined
      const error = err as Error
      console.error(`[queue:${name}] Job ${jobWithId?.id} failed:`, error.message)
    })

    bullWorker.on('error', (err) => {
      const error = err as Error
      console.error(`[queue:${name}] Worker error:`, error.message)
    })

    console.log(`[queue:${name}] Worker started with concurrency ${concurrency}`)

    // For async strategy, return a sentinel result indicating worker mode
    // processed=-1 signals that this is a continuous worker, not a batch process
    return { processed: -1, failed: -1, lastJobId: undefined }
  }

  async function clear(): Promise<{ removed: number }> {
    const queue = await getQueue()

    // Obliterate removes all jobs from the queue
    await queue.obliterate({ force: true })

    return { removed: -1 } // BullMQ obliterate doesn't return count
  }

  async function close(): Promise<void> {
    if (bullWorker) {
      await bullWorker.close()
      bullWorker = null
    }
    if (bullQueue) {
      await bullQueue.close()
      bullQueue = null
    }
  }

  async function getJobCounts(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
  }> {
    const queue = await getQueue()
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed')
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    }
  }

  return {
    name,
    strategy: 'async',
    enqueue,
    process,
    clear,
    close,
    getJobCounts,
  }
}
