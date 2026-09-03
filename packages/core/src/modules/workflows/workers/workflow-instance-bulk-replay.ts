import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  WORKFLOW_INSTANCE_BULK_REPLAY_QUEUE,
  runBulkReplay,
  type BulkReplayJobPayload,
} from '../lib/bulk-replay'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: WORKFLOW_INSTANCE_BULK_REPLAY_QUEUE,
  id: 'workflows:instance-bulk-replay',
  // Replay re-executes real workflows; one batch at a time keeps a bulk retry
  // from becoming its own load spike.
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<BulkReplayJobPayload>,
  _ctx: HandlerContext
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await runBulkReplay({
      container,
      progressJobId: job.payload.progressJobId,
      action: job.payload.action,
      ids: job.payload.ids,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Workflow bulk replay failed',
      },
      {
        tenantId: job.payload.scope.tenantId,
        organizationId: job.payload.scope.organizationId,
        userId: job.payload.scope.userId,
      }
    )
    throw error
  }
}
