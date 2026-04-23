import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  deleteCatalogProductsWithProgress,
  type CatalogProductBulkDeleteJobPayload,
} from '../lib/bulkDelete'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'catalog-product-bulk-delete',
  id: 'catalog:product-bulk-delete',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<CatalogProductBulkDeleteJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await deleteCatalogProductsWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      ids: job.payload.ids,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Bulk product deletion failed',
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
