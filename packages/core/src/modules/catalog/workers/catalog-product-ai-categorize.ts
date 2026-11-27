import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
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

const logger = createLogger('catalog')

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
    try {
      const { translate } = await resolveTranslations()
      await progressService.failJob(
        bulkPayload.progressJobId,
        {
          errorMessage: translate('catalog.aiCategorization.bulk.errors.workerFailed', 'Bulk AI categorization failed'),
        },
        {
          tenantId: bulkPayload.scope.tenantId,
          organizationId: bulkPayload.scope.organizationId,
          userId: bulkPayload.scope.userId,
        },
      )
    } catch (failError) {
      logger.error('catalog.ai_categorization.bulk worker could not mark the progress job failed', {
        progressJobId: bulkPayload.progressJobId,
        err: failError,
      })
    }
    logger.error('catalog.ai_categorization.bulk worker failed; not retrying to avoid repeating paid model calls', {
      progressJobId: bulkPayload.progressJobId,
      err: error,
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'catalog',
      code: 'catalog.ai_categorization_bulk_worker_failed',
    })
  }
}
