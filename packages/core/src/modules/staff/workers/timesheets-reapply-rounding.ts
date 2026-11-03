import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  STAFF_TIME_REAPPLY_ROUNDING_QUEUE,
  type ReapplyRoundingJobPayload,
} from '../lib/time-tracking/reapplyRounding'
import { runTimeTrackingRecalculations } from '../lib/time-tracking/recalculationRunner'

export const metadata: WorkerMeta = {
  queue: STAFF_TIME_REAPPLY_ROUNDING_QUEUE,
  id: 'staff:timesheets-reapply-rounding',
  // One at a time per tenant-wide restatement: the work is a write over the same
  // table the interactive module writes to, and there is nothing to gain from
  // racing two of them.
  concurrency: 1,
}

/**
 * EP-51. The worker iterates the registered recalculation hooks rather than
 * calling the rounding pass directly.
 *
 * A payload with no `hookIds` — which is every job the settings route enqueues —
 * resolves to the built-in rounding hook alone, so a contribution cannot attach
 * itself to the retro-rounding button somebody pressed in the settings screen.
 * An explicit list comes only from the CLI, where running several is a deliberate
 * operator act.
 */
export default async function handle(
  job: QueuedJob<ReapplyRoundingJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await runTimeTrackingRecalculations({
      container,
      progressJobId: job.payload.progressJobId,
      scope: job.payload.scope,
      hookIds: job.payload.hookIds ?? null,
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
