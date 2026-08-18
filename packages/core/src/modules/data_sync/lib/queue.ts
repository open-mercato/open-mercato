import { createModuleQueue, type AbandonedJobInfo, type Queue } from '@open-mercato/queue'
import {
  DATA_SYNC_LOCK_DURATION_MS,
  DATA_SYNC_MAX_STALLED_COUNT,
  DATA_SYNC_QUEUE_ATTEMPTS,
  DATA_SYNC_RESUMABLE_QUEUES,
} from './queue-policy'

const queues = new Map<string, Queue<Record<string, unknown>>>()

const resumableQueueNames = new Set<string>(DATA_SYNC_RESUMABLE_QUEUES)

/**
 * Fail the run behind a job the queue gave up on.
 *
 * A resumable data_sync job is ONE long-lived job for a whole run — `runImport` is entered once and
 * stays there for the duration, which for a full backfill is days. Every worker death (a deploy, an
 * OOM) therefore stalls that job, and BullMQ's stalled counter is cumulative for the job's life:
 * past `DATA_SYNC_MAX_STALLED_COUNT` it writes a deferred failure and the next worker fails the job
 * BEFORE calling the processor.
 *
 * So `runImport` never runs, never throws, and never finalizes — and `sync_runs` is left saying
 * `running` for a run nothing is running, forever. That is the residual state `queue-policy.ts`
 * describes as what remains after a job exhausts its stall budget; this repairs it.
 *
 * It only ever moves a non-terminal run: `markStatus` refuses to overwrite `completed` / `failed` /
 * `cancelled`, so a job abandoned after its run has ended is a no-op. `onJobAbandoned` may deliver
 * the same job more than once, which for the same reason is also a no-op.
 */
async function failAbandonedRun(payload: unknown, info: AbandonedJobInfo): Promise<void> {
  const data = payload as { payload?: { runId?: unknown; scope?: { organizationId?: unknown; tenantId?: unknown } } } | undefined
  const runId = data?.payload?.runId
  const scope = data?.payload?.scope
  // Nothing to repair without both: the run row is keyed by id AND tenant scope.
  if (typeof runId !== 'string' || typeof scope?.organizationId !== 'string' || typeof scope?.tenantId !== 'string') return

  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const container = await createRequestContainer()
  const runService = container.resolve('dataSyncRunService') as {
    markStatus(
      runId: string,
      status: string,
      scope: { organizationId: string; tenantId: string },
      error?: string,
    ): Promise<unknown>
  }
  await runService.markStatus(
    runId,
    'failed',
    { organizationId: scope.organizationId, tenantId: scope.tenantId },
    `the queue abandoned this run's job without running it: ${info.reason}`,
  )
}

export function getSyncQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.DATA_SYNC_QUEUE_CONCURRENCY ?? '5', 10) || 5)
  const created = createModuleQueue<Record<string, unknown>>(
    queueName,
    resumableQueueNames.has(queueName)
      ? {
        concurrency,
        attempts: DATA_SYNC_QUEUE_ATTEMPTS,
        lockDuration: DATA_SYNC_LOCK_DURATION_MS,
        maxStalledCount: DATA_SYNC_MAX_STALLED_COUNT,
        onJobAbandoned: failAbandonedRun,
      }
      : { concurrency },
  )

  queues.set(queueName, created)
  return created
}
