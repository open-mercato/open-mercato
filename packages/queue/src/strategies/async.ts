import type { Queue, QueuedJob, JobHandler, AsyncQueueOptions, ProcessResult, EnqueueOptions, QueueJobScope } from '../types'
import { getRedisUrlOrThrow, parseRedisUrl, REDIS_WIRE_PROTOCOL } from '@open-mercato/shared/lib/redis/connection'
import type { RedisProtocolVersion } from '@open-mercato/shared/lib/redis/connection'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { attachTraceMetadata, runJobInTrace } from '../tracing'
import { createLogger } from '@open-mercato/shared/lib/logger'

const packageLogger = createLogger('queue')

// BullMQ interface types - we define the shape we use to maintain type safety
// while keeping bullmq as an optional peer dependency
type ConnectionOptions = {
  host?: string
  port?: number
  username?: string
  password?: string
  db?: number
  tls?: Record<string, unknown>
  family?: number
  protocol?: RedisProtocolVersion
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
  getJobs: (types: string[], start?: number, end?: number) => Promise<Array<{
    id?: string
    data?: T
    failedReason?: string
    remove: () => Promise<void>
    updateData?: (data: T) => Promise<void>
  }>>
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
    opts: {
      connection: ConnectionOptions
      concurrency: number
      telemetry?: unknown
      lockDuration?: number
      maxStalledCount?: number
    }
  ) => BullWorkerInterface
}

/** The `bullmq-otel` package (optional). Loaded only when an OTLP backend is active. */
type BullMQOtelModule = { BullMQOtel: new (tracerName: string) => object }

const REMOVABLE_JOB_STATES = ['waiting', 'delayed', 'prioritized', 'paused', 'waiting-children']

/**
 * The failures BullMQ records when it gives up on a job *before* handing it to the processor.
 *
 * Both are written as a `defa` (deferred failure) marker on the job, after which the next worker
 * short-circuits in `Worker.processJob` via `getUnrecoverableErrorMessage` and fails the job without
 * calling the handler. The first comes from the stalled-job script once a job's cumulative stall
 * count passes `maxStalledCount`; the second from `maxStartedAttempts`.
 *
 * Matching the reason is what tells "the queue abandoned this" from "the handler ran and threw", and
 * it is deliberately stateless: the alternative — tracking which jobs this process has entered — can
 * only answer "did the handler run *here*", which is the wrong question the moment more than one
 * worker is running. `bullmq-abandoned-reasons.test.ts` asserts these strings still exist in the
 * installed BullMQ, so an upgrade that renames them fails loudly instead of silently disabling the
 * callback.
 */
export const ABANDONED_JOB_REASONS = [
  'job stalled more than allowable limit',
  'job started more than allowable limit',
] as const

function isAbandonedJobReason(message: string): boolean {
  return (ABANDONED_JOB_REASONS as readonly string[]).includes(message)
}

/**
 * Metadata key written onto the stored job once `onJobAbandoned` has completed for it.
 *
 * BullMQ's failed set is the durable record of abandoned jobs (`removeOnFail` keeps them), so it
 * doubles as the dead-letter queue for reports: the sweep re-delivers any abandoned job that does not
 * carry this marker. The marker — not `job.remove()` — is the acknowledgement, so the failed job
 * itself survives for diagnosis.
 */
const ABANDON_REPORT_ACK_KEY = 'abandonReportedAt'

/**
 * How often a worker re-sweeps the failed set for unacknowledged abandoned jobs.
 *
 * Override with `QUEUE_ABANDONED_SWEEP_INTERVAL_MS` to trade recovery latency against Redis chatter.
 */
export const ABANDONED_JOB_SWEEP_INTERVAL_MS = 5 * 60 * 1000

/**
 * How long `close()` waits for in-flight reports before giving up on them.
 *
 * Bounded on purpose: the hook reaches a database, and a shutdown during an infrastructure incident
 * is exactly when that write can hang rather than fail. An unbounded wait would turn a graceful
 * shutdown into a SIGKILL and skip the telemetry flush that follows it. Abandoning the wait is safe
 * because delivery is at-least-once — an unacknowledged report is re-delivered by the next worker's
 * start-up sweep, the same path that covers a process which died mid-report.
 */
export const ABANDONED_JOB_DRAIN_TIMEOUT_MS = 5000

function resolveSweepIntervalMs(): number {
  const configured = Number.parseInt(process.env.QUEUE_ABANDONED_SWEEP_INTERVAL_MS ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : ABANDONED_JOB_SWEEP_INTERVAL_MS
}

function payloadMatchesScope(payload: unknown, scope: QueueJobScope): boolean {
  if (!payload || typeof payload !== 'object') return false
  const scopedPayload = payload as { tenantId?: unknown; organizationId?: unknown; jobType?: unknown }
  if (scopedPayload.tenantId !== scope.tenantId) return false
  if (scope.organizationId !== undefined) {
    if ((scopedPayload.organizationId ?? null) !== scope.organizationId) return false
  }
  if (scope.jobTypes?.length) {
    return typeof scopedPayload.jobType === 'string' && scope.jobTypes.includes(scopedPayload.jobType)
  }
  return true
}

/**
 * Resolves Redis connection options from various sources.
 *
 * BullMQ expects ioredis connection fields rather than a nested URL string.
 * Parse URL-based configuration at this boundary while keeping the public
 * queue API compatible with existing `{ url }` callers.
 */
function resolveConnection(options?: AsyncQueueOptions['connection']): ConnectionOptions {
  if (options?.url) {
    return parseRedisUrl(options.url)
  }

  if (options?.host) {
    return {
      host: options.host,
      port: options.port ?? 6379,
      username: options.username,
      password: options.password,
      db: options.db,
      tls: options.tls,
      family: options.family,
      protocol: REDIS_WIRE_PROTOCOL,
    }
  }

  return parseRedisUrl(getRedisUrlOrThrow('QUEUE'))
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
  const attempts = options?.attempts ?? 3
  const lockDuration = options?.lockDuration
  const maxStalledCount = options?.maxStalledCount
  const onJobAbandoned = options?.onJobAbandoned
  const logger = packageLogger.child({ queue: name })

  let bullQueue: BullQueueInterface<QueuedJob<T>> | null = null
  let bullWorker: BullWorkerInterface | null = null
  let bullmqModule: BullMQModule | null = null
  let abandonedSweepTimer: ReturnType<typeof setInterval> | null = null
  let closing = false

  // In-flight `onJobAbandoned` calls. Detached from the caller that started them (the 'failed'
  // listener or the sweep), so `close()` drains them rather than letting a deploy truncate a repair
  // mid-write. The id set stops the two callers from double-reporting a job inside one process.
  const pendingAbandonedReports = new Set<Promise<void>>()
  const inFlightAbandonedJobIds = new Set<string>()

  type AbandonedJobRecord = {
    id?: string
    data?: QueuedJob<T>
    updateData?: (data: QueuedJob<T>) => Promise<void>
  }

  // The acknowledgement that makes delivery at-least-once: written only after the callback returns,
  // so a callback that threw or a process that died mid-report leaves the job unmarked and a later
  // sweep retries it. Requires the driver to expose `updateData`; without it the report simply stays
  // unacknowledged and repeats, which the idempotency contract permits.
  async function acknowledgeAbandonedReport(job: AbandonedJobRecord): Promise<void> {
    if (!job.data || typeof job.updateData !== 'function') return
    await job.updateData({
      ...job.data,
      metadata: { ...(job.data.metadata ?? {}), [ABANDON_REPORT_ACK_KEY]: new Date().toISOString() },
    })
  }

  function reportAbandonedJob(job: AbandonedJobRecord, reason: string): void {
    if (!onJobAbandoned) return
    const payload = job.data
    if (!payload) return
    if (payload.metadata && payload.metadata[ABANDON_REPORT_ACK_KEY]) return
    if (inFlightAbandonedJobIds.has(payload.id)) return
    inFlightAbandonedJobIds.add(payload.id)

    const jobId = job.id ?? null
    logger.warn('Job abandoned by the queue without running its handler', { jobId, reason })
    const report = (async () => {
      try {
        await onJobAbandoned(payload, { jobId, reason })
      } catch (hookError) {
        logger.error('onJobAbandoned handler threw; the report stays unacknowledged and the sweep will retry it', {
          jobId,
          err: hookError as Error,
        })
        return
      }
      try {
        await acknowledgeAbandonedReport(job)
      } catch (ackError) {
        logger.error('Failed to acknowledge an abandoned-job report; the sweep may repeat it', {
          jobId,
          err: ackError as Error,
        })
      }
    })().finally(() => {
      inFlightAbandonedJobIds.delete(payload.id)
    })
    pendingAbandonedReports.add(report)
    void report.then(() => pendingAbandonedReports.delete(report))
  }

  // The failed set is this strategy's dead-letter queue for abandoned jobs. Enumerating it on worker
  // start and on an interval, and re-delivering anything unacknowledged, is what upgrades the
  // 'failed'-listener fast path from at-most-once to at-least-once: a report lost to a crash is
  // simply still unmarked when the next sweep looks. Residual loss: `removeOnFail` caps the set, so
  // a job evicted before any sweep sees it is gone for good.
  async function sweepAbandonedJobs(): Promise<void> {
    if (!onJobAbandoned || closing) return
    try {
      const queue = await getQueue()
      const failedJobs = await queue.getJobs(['failed'], 0, -1)
      // Re-checked after the awaits: a sweep already past its guard when `close()` ran would
      // otherwise start a report the drain has stopped waiting for. The next start-up sweep
      // re-delivers it, so stopping here loses nothing.
      if (closing) return
      for (const failedJob of failedJobs) {
        const reason = failedJob.failedReason ?? ''
        if (!isAbandonedJobReason(reason)) continue
        reportAbandonedJob(failedJob, reason)
      }
    } catch (sweepError) {
      logger.error('Abandoned-job sweep failed', { err: sweepError as Error })
    }
  }
  // Resolved once: a BullMQOtel instance (delegate async tracing to BullMQ) or
  // undefined (use our own metadata._trace carrier instead). Memoized as the
  // in-flight promise so concurrent first-time callers share one resolution.
  let telemetryPromise: Promise<object | undefined> | null = null

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
    if (!telemetryPromise) {
      telemetryPromise = (async () => {
        if (!getTelemetryRuntime()?.canUseGlobalTracePropagation()) return undefined
        try {
          const mod = (await import('bullmq-otel')) as unknown as BullMQOtelModule
          return new mod.BullMQOtel('open-mercato')
        } catch {
          packageLogger.warn('bullmq-otel not available; using built-in trace carrier', { queue: name })
          return undefined
        }
      })()
    }
    return telemetryPromise
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
      attempts,
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
        ...(lockDuration !== undefined ? { lockDuration } : {}),
        ...(maxStalledCount !== undefined ? { maxStalledCount } : {}),
      }
    )

    // Set up event handlers
    bullWorker.on('completed', (job) => {
      const jobWithId = job as { id?: string }
      logger.info('Job completed', { jobId: jobWithId.id })
    })

    bullWorker.on('failed', (job, err) => {
      const failedJob = job as AbandonedJobRecord | undefined
      const error = err as Error
      logger.error('Job failed', { jobId: failedJob?.id, err: error })

      if (!onJobAbandoned) return
      // Any other reason means a handler ran and threw. That failure is the handler's own and it has
      // already had its chance to record it.
      if (!isAbandonedJobReason(error?.message ?? '')) return
      // No payload means the queue could not give us the job at all. There is nothing to hand the
      // callback and nothing it could repair, so reporting could only ever be a false alarm — the
      // 'Job failed' line above still records it.
      if (!failedJob?.data) return

      // The fast path: report the moment the abandonment is observed. `reportAbandonedJob` runs the
      // callback detached with its own try/catch — this is an EventEmitter, where an unhandled
      // rejection is fatal to the process — and acknowledges the job only afterwards, so a report
      // lost here is retried by the sweep.
      reportAbandonedJob(failedJob, error.message)
    })

    // A stalled job is redelivered under the same id while the previous worker
    // may still be running it, so this is the signal that a handler is about to
    // be executed twice. BullMQ's docs require surfacing it: without this line
    // duplicate processing is invisible.
    bullWorker.on('stalled', (jobId) => {
      logger.warn('Job stalled and will be redelivered — the handler may run concurrently with a previous delivery', {
        jobId: typeof jobId === 'string' ? jobId : null,
      })
    })

    bullWorker.on('error', (err) => {
      const error = err as Error
      logger.error('Worker error', { err: error })
    })

    if (onJobAbandoned) {
      // Sweep immediately so reports lost to a previous process's crash are re-delivered as soon as
      // a worker is back, then keep re-sweeping for anything the fast path loses while running.
      // The timer is unref'd so it never holds the process open.
      void sweepAbandonedJobs()
      abandonedSweepTimer = setInterval(() => {
        void sweepAbandonedJobs()
      }, resolveSweepIntervalMs())
      ;(abandonedSweepTimer as unknown as { unref?: () => void }).unref?.()
    }

    logger.info('Worker started', { concurrency })

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

  async function removeQueuedJobsByScope(scope: QueueJobScope): Promise<{ removed: number }> {
    const queue = await getQueue()
    const jobs = await queue.getJobs(REMOVABLE_JOB_STATES, 0, -1)
    let removed = 0

    for (const job of jobs) {
      if (!payloadMatchesScope(job.data?.payload, scope)) continue
      try {
        await job.remove()
        removed++
      } catch {
        // The job may have started between enumeration and removal. In-flight
        // cancellation is handled by the caller's lock/heartbeat contract.
      }
    }

    return { removed }
  }

  async function close(): Promise<void> {
    closing = true
    if (abandonedSweepTimer) {
      clearInterval(abandonedSweepTimer)
      abandonedSweepTimer = null
    }
    if (bullWorker) {
      await bullWorker.close()
      bullWorker = null
    }
    // Drain any abandonment report still in flight, so a deploy-time shutdown cannot cut off the very
    // repair the callback exists to perform. Bounded: the hook writes to a database, and a shutdown
    // during an incident is exactly when that write can hang instead of failing. Giving up costs
    // nothing permanent — an unacknowledged report is re-delivered by the next start-up sweep.
    if (pendingAbandonedReports.size) {
      const drained = Promise.all([...pendingAbandonedReports]).then(() => true)
      const expired = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ABANDONED_JOB_DRAIN_TIMEOUT_MS)
        ;(timer as unknown as { unref?: () => void }).unref?.()
      })
      if (!(await Promise.race([drained, expired]))) {
        logger.warn('Abandoned-job reports still in flight at shutdown; the sweep will retry them', {
          pending: pendingAbandonedReports.size,
        })
      }
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
    removeQueuedJobsByScope,
    close,
    getJobCounts,
  }
}
