import type {
  Queue,
  QueuedJob,
  JobHandler,
  AsyncQueueOptions,
  ProcessResult,
  EnqueueOptions,
  QueueJobScope,
  FailedJobSummary,
  QueueProcessingStats,
  InFlightJobSummary,
  RecentJob,
} from '../types'
import { getRedisUrlOrThrow, parseRedisUrl, REDIS_WIRE_PROTOCOL } from '@open-mercato/shared/lib/redis/connection'
import type { RedisProtocolVersion } from '@open-mercato/shared/lib/redis/connection'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { attachTraceMetadata, runJobInTrace } from '../tracing'
import {
  MAX_RAW_FAILED_REASON_LENGTH,
  MAX_TYPE_FILTER_CANDIDATES,
  buildCompletedRetentionEnvelope,
  classifyFailureReason,
  resolveJobType,
  resolveOffset,
  resolveWindowSize,
} from '../introspection'
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

/** The subset of a BullMQ `Job`'s own fields this package reads for introspection. */
interface BullJobIntrospectionFields<T> {
  id?: string
  name?: string
  data?: T
  failedReason?: string
  attemptsMade?: number
  /** Epoch ms the job was added to the queue. */
  timestamp?: number
  /** Epoch ms processing started. */
  processedOn?: number
  /** Epoch ms processing finished (completed or failed). */
  finishedOn?: number
  remove: () => Promise<void>
  updateData?: (data: T) => Promise<void>
  /** Resolves the job's actual BullMQ state (`'waiting' | 'active' | ... | 'unknown'`). */
  getState?: () => Promise<string>
}

interface BullQueueInterface<T> {
  add: (
    name: string,
    data: T,
    opts?: {
      removeOnComplete?: boolean | { count: number }
      removeOnFail?: number
      delay?: number
      attempts?: number
      backoff?: { type: string; delay: number }
    },
  ) => Promise<{ id?: string }>
  obliterate: (opts?: { force?: boolean }) => Promise<void>
  close: () => Promise<void>
  getJobCounts: (...states: string[]) => Promise<Record<string, number>>
  getJobs: (
    types: string[],
    start?: number,
    end?: number,
    /** BullMQ defaults to newest-first; `true` requests oldest / next-to-run first. */
    asc?: boolean,
  ) => Promise<Array<BullJobIntrospectionFields<T>>>
  /** Resolves a single job by id, or `undefined` when it does not exist. */
  getJob?: (id: string) => Promise<BullJobIntrospectionFields<T> | undefined>
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

/** How many completed jobs BullMQ keeps per queue (payload-scrubbed) to sample processing times from. */
export const COMPLETED_RETENTION_COUNT = 100

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
// NOTE for anyone adding a retry action: the marker lives inside the job's own payload envelope, so a
// job retried from admin tooling carries it into its next life and a second abandonment of that job
// would never be reported. A retry path must clear `metadata.abandonReportedAt` when it re-enqueues.

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

  /**
   * Report a queue-level failure outward. Wrapped so a telemetry fault can never
   * escape into an EventEmitter handler, where an unhandled rejection is fatal to
   * the process.
   */
  function reportQueueError(
    error: unknown,
    code: string,
    attributes?: Record<string, string | number | undefined>,
  ): void {
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'queue',
        code,
        attributes: { queue: name, ...attributes },
      })
    } catch (telemetryError) {
      // Reporting is never worth a worker — but a systematically broken bridge
      // must not be silent either, or a worker stops reporting and nothing says so.
      logger.warn('Failed to report a queue error to telemetry', { code, err: telemetryError as Error })
    }
  }

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

  /** What BullMQ hands the `failed` handler, beyond the abandonment fields. */
  type FailedJobRecord = AbandonedJobRecord & {
    attemptsMade?: number
    opts?: { attempts?: number }
  }

  // Retained completed jobs exist only so processing-time metrics have a sample, so their payload is
  // reduced to ownership + type the moment they complete. Idempotent; a failure leaves the (bounded,
  // 100-per-queue) record with its payload until BullMQ evicts it, which is reported, not hidden.
  const pendingScrubs = new Set<Promise<void>>()
  function trackScrub(scrub: Promise<void>): void {
    pendingScrubs.add(scrub)
    void scrub.then(() => pendingScrubs.delete(scrub))
  }

  async function scrubCompletedJob(job: AbandonedJobRecord): Promise<void> {
    if (!job.data || typeof job.updateData !== 'function') return
    try {
      await job.updateData(buildCompletedRetentionEnvelope(job.data) as QueuedJob<T>)
    } catch (scrubError) {
      logger.warn('Failed to scrub a completed job payload', { jobId: job.id, err: scrubError as Error })
      reportQueueError(scrubError as Error, 'queue.completed_scrub_failed', { jobId: job.id })
    }
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

  function reportAbandonedJob(job: AbandonedJobRecord, reason: string): Promise<void> | null {
    if (!onJobAbandoned) return null
    const payload = job.data
    if (!payload) return null
    if (payload.metadata && payload.metadata[ABANDON_REPORT_ACK_KEY]) return null
    if (inFlightAbandonedJobIds.has(payload.id)) return null
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
        reportQueueError(hookError as Error, 'queue.abandon_report_failed', { jobId: jobId ?? undefined })
        return
      }
      try {
        await acknowledgeAbandonedReport(job)
      } catch (ackError) {
        logger.error('Failed to acknowledge an abandoned-job report; the sweep may repeat it', {
          jobId,
          err: ackError as Error,
        })
        reportQueueError(ackError as Error, 'queue.abandon_ack_failed', { jobId: jobId ?? undefined })
      }
    })().finally(() => {
      inFlightAbandonedJobIds.delete(payload.id)
    })
    pendingAbandonedReports.add(report)
    void report.then(() => pendingAbandonedReports.delete(report))
    return report
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
        // Re-checked every iteration for the same reason: a long fan-out must not outlive the drain.
        if (closing) return
        const reason = failedJob.failedReason ?? ''
        if (!isAbandonedJobReason(reason)) continue
        // Awaited one at a time. Each report opens a request container and writes to the database, and
        // the worst case for this loop is the first worker start after the feature ships, on a
        // deployment that has been accumulating abandoned jobs — the largest backlog, on the process
        // least able to absorb it. The sweep is a recovery path with no latency requirement (five
        // minutes late is its normal mode), so pacing costs nothing worth having.
        await reportAbandonedJob(failedJob, reason)
      }
    } catch (sweepError) {
      logger.error('Abandoned-job sweep failed', { err: sweepError as Error })
      reportQueueError(sweepError as Error, 'queue.abandon_sweep_failed')
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
    const traceMetadata = telemetry ? undefined : attachTraceMetadata(undefined)
    // Payload-free job type, so the status dashboard can filter without reading business data.
    // The BullMQ job *name* stays the random job id (existing contract), so it cannot carry this.
    const jobType = resolveJobType({ payload: data, metadata: { jobType: options?.jobType } })
    const metadata = jobType ? { ...(traceMetadata ?? {}), jobType } : traceMetadata
    const jobData: QueuedJob<T> = {
      id: crypto.randomUUID(),
      payload: data,
      createdAt: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    }

    const job = await queue.add(jobData.id, jobData, {
      delay: options?.delayMs && options.delayMs > 0 ? options.delayMs : undefined,
      // Bounded completed-job retention: the dashboard's processing-time metrics need a recent
      // sample, and `removeOnComplete: true` leaves none. The worker's `completed` listener
      // immediately reduces each retained job's payload to ownership + type (see
      // `scrubCompletedJob`), so no handler payload outlives its run.
      removeOnComplete: { count: COMPLETED_RETENTION_COUNT },
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
      const completedJob = job as AbandonedJobRecord
      logger.info('Job completed', { jobId: completedJob.id })
      trackScrub(scrubCompletedJob(completedJob))
    })

    bullWorker.on('failed', (job, err) => {
      const failedJob = job as FailedJobRecord | undefined
      const error = err as Error
      // BullMQ counts `attemptsMade` on the job itself, so the last delivery is
      // identifiable here without any bookkeeping of our own. Its per-job
      // `opts.attempts` wins over the strategy default, because a caller may have
      // overridden it.
      const attemptNumber = failedJob?.attemptsMade ?? 0
      const maxAttempts = failedJob?.opts?.attempts ?? attempts
      const exhausted = attemptNumber >= maxAttempts
      logger.error('Job failed', { jobId: failedJob?.id, attemptNumber, maxAttempts, err: error })
      // A log line reaches the backend's LOGS signal; a job that died is an error
      // and belongs in the error signal too, with a code the backend can group on.
      // This is the only outward record for a handler that rethrows after doing its
      // own bookkeeping — a sync worker marking its run `failed`, for instance.
      //
      // One report per failure, coded by what the failure means: a job that has
      // burned every retry is dead-lettered, which is the condition an operator
      // pages on, and it must be distinguishable from a first attempt that BullMQ
      // will simply retry. Matches the local strategy exactly, so an alert written
      // against one holds for the other.
      reportQueueError(error, exhausted ? 'queue.job_exhausted' : 'queue.job_failed', {
        jobId: failedJob?.id,
        attemptNumber,
      })

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
      reportQueueError(error, 'queue.worker_error')
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
    if (pendingScrubs.size) {
      // Bounded for the same reason as the abandoned reports above.
      await Promise.race([
        Promise.allSettled([...pendingScrubs]),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000)
          ;(timer as unknown as { unref?: () => void }).unref?.()
        }),
      ])
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
    delayed?: number
  }> {
    const queue = await getQueue()
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    }
  }

  const MAX_FAILED_SUMMARY_LIMIT = 50
  const DEFAULT_FAILED_SUMMARY_LIMIT = 20
  const MAX_PROCESSING_SAMPLE_SIZE = 200
  const DEFAULT_PROCESSING_SAMPLE_SIZE = 50
  const MAX_IN_FLIGHT_LIMIT = 50
  const DEFAULT_IN_FLIGHT_LIMIT = 20

  type IntrospectedJob = BullJobIntrospectionFields<QueuedJob<T>>

  function matchesType(job: IntrospectedJob, type: string | undefined): boolean {
    return !type || resolveJobType(job.data) === type
  }

  async function getFailedJobsSummary(
    limit: number,
    offset = 0,
    opts?: { type?: string },
  ): Promise<FailedJobSummary[]> {
    const cappedLimit = resolveWindowSize(limit, DEFAULT_FAILED_SUMMARY_LIMIT, MAX_FAILED_SUMMARY_LIMIT)
    // BullMQ reads range 0..-1 as "everything", so a zero window must never reach it.
    if (cappedLimit === 0) return []
    const queue = await getQueue()
    const boundedOffset = resolveOffset(offset)
    const fetchCount = opts?.type ? Math.max(cappedLimit, MAX_TYPE_FILTER_CANDIDATES) : cappedLimit
    const jobs = await queue.getJobs(['failed'], boundedOffset, boundedOffset + fetchCount - 1)
    // Allow-list map — neither `job.data` (the raw payload) nor the raw `failedReason` text is
    // forwarded: a handler's exception message can echo tenant data or credentials, and this is
    // the broadly-granted Tier 1 surface. Only a stable error code leaves here.
    return jobs
      .filter((job) => matchesType(job, opts?.type))
      .slice(0, cappedLimit)
      .map((job) => ({
        id: job.id ?? '',
        queue: name,
        type: resolveJobType(job.data),
        errorCode: classifyFailureReason(job.failedReason),
        attemptsMade: job.attemptsMade,
        failedAt: job.finishedOn,
      }))
  }

  async function getProcessingStats(opts?: { type?: string; sampleSize?: number }): Promise<QueueProcessingStats> {
    const sampleSize = resolveWindowSize(opts?.sampleSize, DEFAULT_PROCESSING_SAMPLE_SIZE, MAX_PROCESSING_SAMPLE_SIZE)
    if (sampleSize === 0) return { sampleSize: 0, fidelity: 'exact' }
    const queue = await getQueue()
    const fetchCount = opts?.type ? Math.max(sampleSize, MAX_TYPE_FILTER_CANDIDATES) : sampleSize
    // Newest-first bounded window — never a full scan, regardless of queue size. Completed jobs
    // are retained (payload-scrubbed) for exactly this purpose; see `COMPLETED_RETENTION_COUNT`.
    const jobs = await queue.getJobs(['completed'], 0, fetchCount - 1)
    const sample = jobs.filter((job) => matchesType(job, opts?.type)).slice(0, sampleSize)

    const processingDurations: number[] = []
    const waitDurations: number[] = []
    let lastProcessingMs: number | undefined
    let lastCompletedAt: number | undefined

    for (const job of sample) {
      if (typeof job.processedOn === 'number' && typeof job.finishedOn === 'number') {
        const duration = job.finishedOn - job.processedOn
        processingDurations.push(duration)
        // `getJobs(['completed'], ...)` is newest-first, so the first sampled job
        // with both timestamps is the most recently completed one.
        if (lastProcessingMs === undefined) {
          lastProcessingMs = duration
          lastCompletedAt = job.finishedOn
        }
      }
      if (typeof job.processedOn === 'number' && typeof job.timestamp === 'number') {
        waitDurations.push(job.processedOn - job.timestamp)
      }
    }

    const avg = (values: number[]): number | undefined =>
      values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined
    const p95 = (values: number[]): number | undefined => {
      if (!values.length) return undefined
      const sorted = [...values].sort((a, b) => a - b)
      const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
      return sorted[Math.max(0, index)]
    }

    return {
      sampleSize: sample.length,
      lastProcessingMs,
      avgProcessingMs: avg(processingDurations),
      p95ProcessingMs: p95(processingDurations),
      avgWaitMs: avg(waitDurations),
      lastCompletedAt,
      fidelity: 'exact',
    }
  }

  async function getInFlightJobsSummary(opts: {
    state?: 'active' | 'waiting' | 'delayed'
    type?: string
    limit: number
  }): Promise<InFlightJobSummary[]> {
    const state = opts.state ?? 'active'
    const cappedLimit = resolveWindowSize(opts.limit, DEFAULT_IN_FLIGHT_LIMIT, MAX_IN_FLIGHT_LIMIT)
    if (cappedLimit === 0) return []
    const queue = await getQueue()
    const fetchCount = opts.type ? Math.max(cappedLimit, MAX_TYPE_FILTER_CANDIDATES) : cappedLimit
    // `asc: true` is what makes this the HEAD of the queue: BullMQ's default is newest-first, which
    // would sample fresh arrivals and could hide the oldest stuck job entirely. Oldest / next-to-run
    // first for waiting & delayed, longest-running first for active. Never a full scan.
    const jobs = await queue.getJobs([state], 0, fetchCount - 1, true)
    const filtered = jobs.filter((job) => matchesType(job, opts.type)).slice(0, cappedLimit)
    const now = Date.now()

    return filtered.map((job) => {
      const enqueuedAt = job.timestamp
      const startedAt = state === 'active' ? job.processedOn : undefined
      return {
        id: job.id ?? '',
        queue: name,
        type: resolveJobType(job.data),
        state,
        enqueuedAt,
        startedAt,
        runningMs: startedAt !== undefined ? now - startedAt : undefined,
        ageMs: state !== 'active' && enqueuedAt !== undefined ? now - enqueuedAt : undefined,
        attemptsMade: job.attemptsMade,
      }
    })
  }

  const MAX_RECENT_JOBS_LIMIT = 100
  const DEFAULT_RECENT_JOBS_LIMIT = 20
  const ALL_JOB_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const
  type RecentJobState = (typeof ALL_JOB_STATES)[number]

  /** The timestamp that orders a job inside its own state — "when did this last happen". */
  function recencyOf(job: IntrospectedJob, state: string): number {
    if (state === 'failed' || state === 'completed') return job.finishedOn ?? job.processedOn ?? job.timestamp ?? 0
    if (state === 'active') return job.processedOn ?? job.timestamp ?? 0
    return job.timestamp ?? 0
  }

  /**
   * Tier 2 (privileged) ONLY. Unwraps this package's own `QueuedJob<T>` envelope
   * so `data` carries the caller's actual payload (what an operator means by
   * "the job's payload"), not the `{id, payload, createdAt, metadata}` wrapper.
   * `failedReason` stays raw here — the caller redacts it behind the tenant filter.
   */
  function toRecentJob(job: IntrospectedJob, state: string | undefined): RecentJob {
    return {
      id: job.id ?? job.data?.id ?? '',
      queue: name,
      state,
      type: resolveJobType(job.data),
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason?.slice(0, MAX_RAW_FAILED_REASON_LENGTH),
      data: job.data?.payload,
    }
  }

  async function resolveActualState(job: IntrospectedJob): Promise<string | undefined> {
    if (typeof job.getState !== 'function') return undefined
    const actual = await job.getState()
    if (!actual || actual === 'unknown') return undefined
    return actual === 'prioritized' ? 'waiting' : actual
  }

  async function getRecentJobs(opts: {
    state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
    type?: string
    id?: string
    limit: number
    offset?: number
  }): Promise<RecentJob[]> {
    if (opts.id) {
      // Single-job path: bounded to exactly one job, regardless of `limit`.
      const queue = await getQueue()
      if (typeof queue.getJob !== 'function') return []
      const job = await queue.getJob(opts.id)
      if (!job) return []
      // The caller's `state` is a query, not a fact — report what BullMQ says the job is.
      return [toRecentJob(job as IntrospectedJob, await resolveActualState(job as IntrospectedJob))]
    }

    const cappedLimit = resolveWindowSize(opts.limit, DEFAULT_RECENT_JOBS_LIMIT, MAX_RECENT_JOBS_LIMIT)
    if (cappedLimit === 0) return []
    const queue = await getQueue()
    const boundedOffset = resolveOffset(opts.offset)
    const wanted = boundedOffset + cappedLimit
    const perStateFetch = opts.type ? Math.max(wanted, MAX_TYPE_FILTER_CANDIDATES) : wanted
    const states: readonly RecentJobState[] = opts.state ? [opts.state] : ALL_JOB_STATES

    // One bounded read per state (so each job keeps its real state), then ONE global ordering by
    // recency before the window is cut. Reading `getJobs(allStates, ...)` instead concatenates the
    // states in request order, so a backlog of waiting jobs would fill the window and push newer
    // failures out of it.
    const perState = await Promise.all(
      states.map(async (state) => {
        const jobs = await queue.getJobs([state], 0, perStateFetch - 1)
        return jobs
          .filter((job) => matchesType(job, opts.type))
          .map((job) => ({ job, state, recency: recencyOf(job, state) }))
      }),
    )

    return perState
      .flat()
      .sort((a, b) => b.recency - a.recency)
      .slice(boundedOffset, wanted)
      .map(({ job, state }) => toRecentJob(job, state))
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
    getFailedJobsSummary,
    getProcessingStats,
    getInFlightJobsSummary,
    getRecentJobs,
  }
}
