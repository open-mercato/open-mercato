import { QueueIntrospectionUnavailableError } from '@open-mercato/queue'
import { currentQueueStrategy, listRegisteredQueues, resolveStatusQueue } from './queue-status-registry'
import { QUEUE_STATUS_ERROR_CODES, reportQueueStatusError } from './queue-status-telemetry'
import type {
  QueueStatusSnapshot,
  QueueStatusEntryDto,
} from './queue-status.types'

const DEFAULT_FAILED_JOBS_LIMIT = 20
const DEFAULT_IN_FLIGHT_LIMIT = 20
const DEFAULT_PROCESSING_SAMPLE_SIZE = 50

export type BuildQueueStatusSnapshotOptions = {
  /** Restrict the snapshot to a single registered queue. Unknown names yield an empty, non-erroring snapshot. */
  queue?: string | null
  /** Restrict the bounded summaries (failed/in-flight/processing-sample) to a single job type/name. */
  type?: string | null
  /** True when the session holds `configs.queues_status.inspect_payloads` — echoed so the UI can gate click-through. */
  canInspectPayloads?: boolean
}

/** How long one queue's introspection reads may take before the entry degrades to an error state. */
const DEFAULT_QUEUE_READ_TIMEOUT_MS = 5000

/** Stable error codes a Tier 1 entry may carry — never raw exception text. */
export const QUEUE_ENTRY_ERROR_UNAVAILABLE = 'queue_unavailable'
export const QUEUE_ENTRY_ERROR_READ_FAILED = 'queue_read_failed'

class QueueReadTimeoutError extends Error {
  constructor(queueName: string, timeoutMs: number) {
    super(`Queue "${queueName}" did not answer within ${timeoutMs}ms`)
    this.name = 'QueueReadTimeoutError'
  }
}

export function isQueueReadTimeoutError(error: unknown): boolean {
  return error instanceof QueueReadTimeoutError
}

function resolveQueueReadTimeoutMs(): number {
  const configured = Number.parseInt(process.env.QUEUE_STATUS_READ_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUEUE_READ_TIMEOUT_MS
}

/**
 * Bounds one queue's reads. With Redis down BullMQ buffers commands on its offline queue and never
 * rejects, so without this the whole snapshot (and the dashboard's spinner) would hang forever.
 * The abandoned reads are left to settle on their own; their rejections are swallowed here.
 */
export async function withQueueReadTimeout<R>(queueName: string, work: Promise<R>, timeoutMs = resolveQueueReadTimeoutMs()): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueReadTimeoutError(queueName, timeoutMs)), timeoutMs)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  })
  work.catch(() => undefined)
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** An optional section a strategy cannot serve within its bounds is "unavailable", not "empty". */
async function optionalSection<R>(read: () => Promise<R>): Promise<{ value: R | undefined; unavailable: boolean }> {
  try {
    return { value: await read(), unavailable: false }
  } catch (error) {
    if (error instanceof QueueIntrospectionUnavailableError) return { value: undefined, unavailable: true }
    throw error
  }
}

async function readQueueEntry(
  queueName: string,
  workerIds: string[],
  concurrency: number | null,
  type: string | null,
): Promise<QueueStatusEntryDto> {
  const instance = resolveStatusQueue(queueName)
  const strategy = instance.strategy
  // The queue carries no per-job worker id, so attribute it from the registry only when it is
  // unambiguous: exactly one worker consumes this queue.
  const soleWorkerId = workerIds.length === 1 ? workerIds[0] : undefined
  const withWorker = <J extends { workerId?: string }>(job: J): J =>
    soleWorkerId && !job.workerId ? { ...job, workerId: soleWorkerId } : job

  const counts = await instance.getJobCounts()

  let failedJobs: QueueStatusEntryDto['failedJobs']
  let failedJobsUnavailable = typeof instance.getFailedJobsSummary !== 'function'
  if (!failedJobsUnavailable) {
    const failed = await optionalSection(() =>
      instance.getFailedJobsSummary!(DEFAULT_FAILED_JOBS_LIMIT, 0, { type: type ?? undefined }),
    )
    failedJobsUnavailable = failed.unavailable
    failedJobs = failed.value?.map(withWorker)
  }

  const processingStats = typeof instance.getProcessingStats === 'function'
    ? (await optionalSection(() =>
        instance.getProcessingStats!({ type: type ?? undefined, sampleSize: DEFAULT_PROCESSING_SAMPLE_SIZE }),
      )).value
    : undefined

  let inFlightUnavailable = typeof instance.getInFlightJobsSummary !== 'function'
  let inFlight: QueueStatusEntryDto['inFlight']
  let agedWaiting: QueueStatusEntryDto['agedWaiting']
  if (!inFlightUnavailable) {
    const read = (state: 'active' | 'waiting' | 'delayed') =>
      optionalSection(() =>
        instance.getInFlightJobsSummary!({ state, type: type ?? undefined, limit: DEFAULT_IN_FLIGHT_LIMIT }),
      )
    const [active, waiting, delayed] = await Promise.all([read('active'), read('waiting'), read('delayed')])
    inFlightUnavailable = active.unavailable || waiting.unavailable || delayed.unavailable
    if (!inFlightUnavailable) {
      inFlight = (active.value ?? []).map(withWorker)
      // One row per job id: a strategy that cannot tell waiting from delayed must not list a job twice.
      const seen = new Set<string>()
      agedWaiting = [...(waiting.value ?? []), ...(delayed.value ?? [])]
        .filter((job) => (seen.has(job.id) ? false : (seen.add(job.id), true)))
        .sort((a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0))
        .slice(0, DEFAULT_IN_FLIGHT_LIMIT)
        .map(withWorker)
    }
  }

  return {
    queue: queueName,
    workerIds,
    concurrency,
    strategy,
    fidelity: strategy === 'local' ? 'partial' : 'exact',
    counts,
    failedJobs,
    failedJobsUnavailable,
    processingStats,
    inFlight,
    agedWaiting,
    inFlightUnavailable,
  }
}

async function buildQueueEntry(
  queueName: string,
  workerIds: string[],
  concurrency: number | null,
  type: string | null,
): Promise<QueueStatusEntryDto> {
  try {
    return await withQueueReadTimeout(queueName, readQueueEntry(queueName, workerIds, concurrency, type))
  } catch (error) {
    const timedOut = error instanceof QueueReadTimeoutError
    reportQueueStatusError(
      error,
      timedOut ? QUEUE_STATUS_ERROR_CODES.queueReadTimeout : QUEUE_STATUS_ERROR_CODES.queueReadFailed,
      { queue: queueName },
    )
    let strategy: 'local' | 'async'
    try {
      strategy = resolveStatusQueue(queueName).strategy
    } catch {
      strategy = currentQueueStrategy()
    }
    return {
      queue: queueName,
      workerIds,
      concurrency,
      strategy,
      fidelity: strategy === 'local' ? 'partial' : 'exact',
      counts: { waiting: 0, active: 0, completed: 0, failed: 0 },
      failedJobsUnavailable: true,
      inFlightUnavailable: true,
      // Stable code only — the raw exception text can carry connection strings or tenant data
      // and this entry is part of the broadly-granted Tier 1 response.
      error: timedOut ? QUEUE_ENTRY_ERROR_UNAVAILABLE : QUEUE_ENTRY_ERROR_READ_FAILED,
    }
  }
}

/**
 * Builds the Tier 1 (payload-free, broadly-accessible) queue status snapshot.
 * Every call this makes is a bounded, aggregate, or small-window read —
 * no full-queue enumeration, and `job.data` is never touched (#3105).
 */
export async function buildQueueStatusSnapshot(
  options: BuildQueueStatusSnapshotOptions = {},
): Promise<QueueStatusSnapshot> {
  const registered = listRegisteredQueues()
  const queueFilter = options.queue?.trim() || null
  const typeFilter = options.type?.trim() || null

  // Unknown ?queue= name yields an empty, non-erroring snapshot rather than a 404/500 —
  // the dashboard narrows, it never widens, and a typo should not look like a server fault.
  const targeted = queueFilter
    ? registered.filter((entry) => entry.queue === queueFilter)
    : registered

  const queues = await Promise.all(
    targeted.map((entry) => buildQueueEntry(entry.queue, entry.workerIds, entry.concurrency, typeFilter)),
  )

  return {
    generatedAt: new Date().toISOString(),
    filter: { queue: queueFilter, type: typeFilter },
    queues,
    canInspectPayloads: options.canInspectPayloads === true,
  }
}
