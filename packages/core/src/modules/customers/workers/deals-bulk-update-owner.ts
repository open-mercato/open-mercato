import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  CUSTOMERS_DEALS_BULK_UPDATE_OWNER_QUEUE,
  bulkUpdateDealOwnerWithProgress,
  type CustomersDealsBulkUpdateOwnerJobPayload,
} from '../lib/bulkDeals'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: CUSTOMERS_DEALS_BULK_UPDATE_OWNER_QUEUE,
  id: 'customers:deals-bulk-update-owner',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<CustomersDealsBulkUpdateOwnerJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await bulkUpdateDealOwnerWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      ids: job.payload.ids,
      ownerUserId: job.payload.ownerUserId,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage:
          error instanceof Error ? error.message : 'Bulk deal owner update failed',
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
