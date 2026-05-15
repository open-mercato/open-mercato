import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE,
  bulkUpdateDealStageWithProgress,
  type CustomersDealsBulkUpdateStageJobPayload,
} from '../lib/bulkDeals'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE,
  id: 'customers:deals-bulk-update-stage',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<CustomersDealsBulkUpdateStageJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await bulkUpdateDealStageWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      ids: job.payload.ids,
      pipelineStageId: job.payload.pipelineStageId,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage:
          error instanceof Error ? error.message : 'Bulk deal stage update failed',
      },
      {
        tenantId: job.payload.scope.tenantId,
        organizationId: job.payload.scope.organizationId,
        userId: job.payload.scope.userId,
      },
    )
    throw error
  }
}
