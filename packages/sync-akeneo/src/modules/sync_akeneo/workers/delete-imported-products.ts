import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import {
  AKENEO_DELETE_IMPORTED_PRODUCTS_QUEUE,
  deleteImportedProductsWithProgress,
  type DeleteImportedProductsJobPayload,
} from '../lib/delete-imported-products'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: AKENEO_DELETE_IMPORTED_PRODUCTS_QUEUE,
  id: 'sync-akeneo:delete-imported-products',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<DeleteImportedProductsJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await deleteImportedProductsWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Failed to delete imported Akeneo products',
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
