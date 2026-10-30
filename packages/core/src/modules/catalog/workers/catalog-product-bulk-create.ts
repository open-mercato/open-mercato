import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  CATALOG_PRODUCT_BULK_CREATE_QUEUE,
  createCatalogProductsWithProgress,
  type CatalogProductBulkCreateJobPayload,
} from '../lib/bulkCreateProducts'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: CATALOG_PRODUCT_BULK_CREATE_QUEUE,
  id: 'catalog:product-bulk-create',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<CatalogProductBulkCreateJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await createCatalogProductsWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      items: job.payload.items,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Bulk product creation failed',
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
