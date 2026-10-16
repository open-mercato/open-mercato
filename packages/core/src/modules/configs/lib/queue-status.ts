import { listRegisteredQueues, resolveStatusQueue } from './queue-status-registry'
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

async function buildQueueEntry(
  queueName: string,
  workerIds: string[],
  concurrency: number | null,
  type: string | null,
): Promise<QueueStatusEntryDto> {
  const instance = resolveStatusQueue(queueName)
  const strategy = instance.strategy

  try {
    const counts = await instance.getJobCounts()

    const failedJobsUnavailable = typeof instance.getFailedJobsSummary !== 'function'
    const failedJobs = failedJobsUnavailable
      ? undefined
      : await instance.getFailedJobsSummary!(DEFAULT_FAILED_JOBS_LIMIT)

    const processingStats = typeof instance.getProcessingStats === 'function'
      ? await instance.getProcessingStats({ type: type ?? undefined, sampleSize: DEFAULT_PROCESSING_SAMPLE_SIZE })
      : undefined

    const inFlightUnavailable = typeof instance.getInFlightJobsSummary !== 'function'
    let inFlight: QueueStatusEntryDto['inFlight']
    let agedWaiting: QueueStatusEntryDto['agedWaiting']
    if (!inFlightUnavailable) {
      inFlight = await instance.getInFlightJobsSummary!({
        state: 'active',
        type: type ?? undefined,
        limit: DEFAULT_IN_FLIGHT_LIMIT,
      })
      const [waiting, delayed] = await Promise.all([
        instance.getInFlightJobsSummary!({ state: 'waiting', type: type ?? undefined, limit: DEFAULT_IN_FLIGHT_LIMIT }),
        instance.getInFlightJobsSummary!({ state: 'delayed', type: type ?? undefined, limit: DEFAULT_IN_FLIGHT_LIMIT }),
      ])
      agedWaiting = [...waiting, ...delayed]
        .sort((a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0))
        .slice(0, DEFAULT_IN_FLIGHT_LIMIT)
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
  } catch (error) {
    return {
      queue: queueName,
      workerIds,
      concurrency,
      strategy,
      fidelity: strategy === 'local' ? 'partial' : 'exact',
      counts: { waiting: 0, active: 0, completed: 0, failed: 0 },
      failedJobsUnavailable: true,
      inFlightUnavailable: true,
      error: error instanceof Error ? error.message : 'Failed to load queue status',
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
