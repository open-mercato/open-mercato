import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  STAFF_TIME_REAPPLY_ROUNDING_QUEUE,
  reapplyRoundingWithProgress,
  type ReapplyRoundingJobPayload,
} from '../lib/time-tracking/reapplyRounding'

export const metadata: WorkerMeta = {
  queue: STAFF_TIME_REAPPLY_ROUNDING_QUEUE,
  id: 'staff:timesheets-reapply-rounding',
  // One at a time per tenant-wide restatement: the work is a write over the same
  // table the interactive module writes to, and there is nothing to gain from
  // racing two of them.
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<ReapplyRoundingJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await reapplyRoundingWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage:
          error instanceof Error ? error.message : 'Reapplying the rounding rule failed',
      },
      {
        tenantId: job.payload.scope.tenantId,
        organizationId:
          job.payload.scope.organizationIds?.length === 1 ? job.payload.scope.organizationIds[0] : null,
        userId: job.payload.scope.userId ?? null,
      },
    )
    throw error
  }
}
