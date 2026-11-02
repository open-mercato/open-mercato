import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE,
  categorizeProductsWithProgress,
  resolveAiCategorizeConcurrency,
  type CatalogProductAiCategorizeJobPayload,
} from '../lib/aiCategorization/bulkCategorize'
import {
  isOnCreateJobPayload,
  runOnCreateSuggestion,
  type CatalogProductAiCategorizeOnCreateJobPayload,
} from '../lib/aiCategorization/onCreateSuggest'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE,
  id: 'catalog:product-ai-categorize',
  concurrency: resolveAiCategorizeConcurrency(process.env.CATALOG_AI_CATEGORIZE_CONCURRENCY),
}

export default async function handle(
  job: QueuedJob<CatalogProductAiCategorizeJobPayload | CatalogProductAiCategorizeOnCreateJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  if (isOnCreateJobPayload(job.payload)) {
    await runOnCreateSuggestion({ container, payload: job.payload })
    return
  }

  const bulkPayload = job.payload

  try {
    await categorizeProductsWithProgress({
      container,
      progressJobId: bulkPayload.progressJobId,
      ids: bulkPayload.ids,
      scope: bulkPayload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      bulkPayload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Bulk AI categorization failed',
      },
      {
        tenantId: bulkPayload.scope.tenantId,
        organizationId: bulkPayload.scope.organizationId,
        userId: bulkPayload.scope.userId,
      },
    )
    throw error
  }
}
