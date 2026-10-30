/**
 * Async-activity wait resolution, PURE.
 *
 * A transition that queues async activities parks its token (instance or
 * branch) and records the queue job ids it is waiting for in
 * `_pendingAsyncActivities`. The worker logs one `ACTIVITY_COMPLETED` /
 * `ACTIVITY_FAILED` event per delivery attempt, keyed by `jobId`, and the event
 * log keeps every earlier wait's events. The wait is therefore decided by the
 * outcome of exactly the jobs it queued — one outcome per job — and never by
 * events of an earlier wait, an earlier attempt of the run, or a duplicate
 * delivery. A job with a completed attempt counts as completed; otherwise any
 * logged failed attempt counts as its failure, whether or not the queue retries
 * it later. `events` must be in log order: the last event per job and outcome
 * is the one used.
 */

export const ASYNC_ACTIVITY_OUTCOME_EVENT_TYPES = ['ACTIVITY_COMPLETED', 'ACTIVITY_FAILED'] as const

export type AsyncActivityOutcomeEvent = {
  eventType: string
  eventData: Record<string, unknown> | null | undefined
}

export type AsyncActivityWaitResolution<TEvent extends AsyncActivityOutcomeEvent> = {
  settled: boolean
  completed: TEvent[]
  failed: TEvent[]
}

export function readPendingAsyncJobIds(pending: unknown): string[] {
  if (!Array.isArray(pending)) return []
  const jobIds: string[] = []
  for (const entry of pending) {
    const jobId = entry && typeof entry === 'object' ? (entry as { jobId?: unknown }).jobId : undefined
    if (typeof jobId === 'string' && jobId.length > 0 && !jobIds.includes(jobId)) jobIds.push(jobId)
  }
  return jobIds
}

export function resolveAsyncActivityWait<TEvent extends AsyncActivityOutcomeEvent>(
  pendingJobIds: readonly string[],
  events: readonly TEvent[],
): AsyncActivityWaitResolution<TEvent> {
  const completedByJob = new Map<string, TEvent>()
  const failedByJob = new Map<string, TEvent>()
  for (const event of events) {
    const jobId = event.eventData?.jobId
    if (typeof jobId !== 'string') continue
    if (event.eventType === 'ACTIVITY_COMPLETED') completedByJob.set(jobId, event)
    else if (event.eventType === 'ACTIVITY_FAILED') failedByJob.set(jobId, event)
  }

  const completed: TEvent[] = []
  const failed: TEvent[] = []
  let settled = true
  for (const jobId of pendingJobIds) {
    const completion = completedByJob.get(jobId)
    if (completion) {
      completed.push(completion)
      continue
    }
    const failure = failedByJob.get(jobId)
    if (failure) {
      failed.push(failure)
      continue
    }
    settled = false
  }

  return { settled, completed, failed }
}
