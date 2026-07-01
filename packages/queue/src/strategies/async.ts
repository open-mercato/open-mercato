import type { Queue, QueuedJob, JobHandler, AsyncQueueOptions, ProcessResult, EnqueueOptions } from '../types'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { isOtelSdkBackend } from '@open-mercato/telemetry'
import { attachTraceMetadata, runJobInTrace } from '../tracing'

// BullMQ interface types - we define the shape we use to maintain type safety
// while keeping bullmq as an optional peer dependency
type ConnectionOptions = {
  url?: string
  host?: string
  port?: number
  username?: string
  password?: string
  db?: number
  tls?: Record<string, unknown>
}

interface BullQueueInterface<T> {
  add: (
    name: string,
    data: T,
    opts?: {
      removeOnComplete?: boolean
      removeOnFail?: number
      delay?: number
      attempts?: number
      backoff?: { type: string; delay: number }
    },
  ) => Promise<{ id?: string }>
  obliterate: (opts?: { force?: boolean }) => Promise<void>
  close: () => Promise<void>
  getJobCounts: (...states: string[]) => Promise<Record<string, number>>
}

interface BullWorkerInterface {
  on: (event: string, handler: (...args: unknown[]) => void) => void
  close: () => Promise<void>
}

interface BullMQModule {
  Queue: new <T>(name: string, opts: { connection: ConnectionOptions; telemetry?: unknown }) => BullQueueInterface<T>
  Worker: new <T>(
    name: string,
    processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
    opts: { connection: ConnectionOptions; concurrency: number; telemetry?: unknown }
  ) => BullWorkerInterface
}

/** The `bullmq-otel` package (optional). Loaded only when an OTLP backend is active. */
type BullMQOtelModule = { BullMQOtel: new (tracerName: string) => object }

/**
 * Resolves Redis connection options from various sources.
 *
 * BullMQ expects an ioredis-compatible connection object. Preserve the full
 * Redis URL under the `url` key so rediss://, username, database, and query
 * params are not lost in translation.
 */
function resolveConnection(options?: AsyncQueueOptions['connection']): ConnectionOptions {
  if (options?.url) {
    return { url: options.url }
  }

  if (options?.host) {
    return {
      host: options.host,
      port: options.port ?? 6379,
      username: options.username,
      password: options.password,
      db: options.db,
      tls: options.tls,
    }
  }

  return { url: getRedisUrlOrThrow('QUEUE') }
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
  // Resolved once: a BullMQOtel instance (delegate async tracing to BullMQ) or
  // null (use our own metadata._trace carrier instead).
  let telemetryResolved = false
  let telemetryInstance: object | null = null

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

  /**
   * When an OTLP backend is active, delegate async-queue tracing to `bullmq-otel`
   * (richer BullMQ-internal spans: add / process / wait / attempts). Returns
   * `undefined` — meaning "use our own `metadata._trace` carrier" — when telemetry
   * is off, a non-OTEL backend is selected, or `bullmq-otel` isn't installed. (The
   * `local` strategy always uses our carrier; it isn't BullMQ, so `bullmq-otel`
   * cannot instrument it.)
   */
  async function getQueueTelemetry(): Promise<object | undefined> {
    if (telemetryResolved) return telemetryInstance ?? undefined
    telemetryResolved = true
    if (!isOtelSdkBackend()) return undefined
    try {
      const mod = (await import('bullmq-otel')) as unknown as BullMQOtelModule
      telemetryInstance = new mod.BullMQOtel('open-mercato')
    } catch {
      console.warn(`[queue:${name}] bullmq-otel not available; using built-in trace carrier`)
      telemetryInstance = null
    }
    return telemetryInstance ?? undefined
  }

  async function getQueue(): Promise<BullQueueInterface<QueuedJob<T>>> {
    if (!bullQueue) {
      const { Queue: BullQueueClass } = await getBullMQ()
      const telemetry = await getQueueTelemetry()
      bullQueue = new BullQueueClass<QueuedJob<T>>(name, { connection, ...(telemetry ? { telemetry } : {}) })
    }
    return bullQueue
  }

  // -------------------------------------------------------------------------
  // Queue Implementation
  // -------------------------------------------------------------------------

  async function enqueue(data: T, options?: EnqueueOptions): Promise<string> {
    const queue = await getQueue()
    // When bullmq-otel handles propagation, don't also attach our carrier.
    const telemetry = await getQueueTelemetry()
    const metadata = telemetry ? undefined : attachTraceMetadata(undefined)
    const jobData: QueuedJob<T> = {
      id: crypto.randomUUID(),
      payload: data,
      createdAt: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    }

    const job = await queue.add(jobData.id, jobData, {
      delay: options?.delayMs && options.delayMs > 0 ? options.delayMs : undefined,
      removeOnComplete: true,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    })

    return job.id ?? jobData.id
  }

  async function process(handler: JobHandler<T>): Promise<ProcessResult> {
    const { Worker } = await getBullMQ()
    const telemetry = await getQueueTelemetry()

    // Create worker that processes jobs
    bullWorker = new Worker<QueuedJob<T>>(
      name,
      async (job) => {
        const jobData = job.data
        const ctx = {
          jobId: job.id ?? jobData.id,
          attemptNumber: job.attemptsMade + 1,
          queueName: name,
        }
        // With bullmq-otel active, BullMQ owns the process span and active
        // context (the handler's pg/undici spans nest under it). Otherwise
        // continue the trace from our own carrier.
        if (telemetry) {
          await handler(jobData, ctx)
        } else {
          await runJobInTrace(name, jobData.metadata, () => handler(jobData, ctx))
        }
      },
      {
        connection,
        concurrency,
        ...(telemetry ? { telemetry } : {}),
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
