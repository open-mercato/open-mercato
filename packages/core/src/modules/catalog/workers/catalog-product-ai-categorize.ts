import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE,
  categorizeProductsWithProgress,
  resolveAiCategorizeConcurrency,
  type CatalogProductAiCategorizeJobPayload,
} from '../lib/aiCategorization/bulkCategorize'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE,
  id: 'catalog:product-ai-categorize',
  concurrency: resolveAiCategorizeConcurrency(process.env.CATALOG_AI_CATEGORIZE_CONCURRENCY),
}

export default async function handle(
  job: QueuedJob<CatalogProductAiCategorizeJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await categorizeProductsWithProgress({
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
        errorMessage: error instanceof Error ? error.message : 'Bulk AI categorization failed',
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
