import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ProgressService, ProgressServiceContext } from '../../../progress/lib/progressService'
import type { CatalogCategorizationService } from './categorizationService'
import { CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS } from './bulkLimits'
import { createProductSuggester, type ProductSuggester } from './suggestProduct'

export const CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE = 'catalog-product-ai-categorize'
export const CATALOG_PRODUCT_AI_CATEGORIZE_JOB_TYPE = 'catalog.products.ai_categorize'
export { CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS }

const RATE_LIMIT_RETRY_DELAY_MS = 2000
const MAX_RECORDED_FAILURES = 50
const FAIL_FAST_CODES = new Set(['insufficient_credits', 'auth'])

export type CatalogProductAiCategorizeScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type CatalogProductAiCategorizeJobPayload = {
  progressJobId: string
  ids: string[]
  scope: CatalogProductAiCategorizeScope
}

export type CatalogProductAiCategorizeFailure = {
  productId: string
  code: string
}

export type CatalogProductAiCategorizeStopReason =
  | 'feature_disabled'
  | 'cancelled'
  | 'insufficient_credits'
  | 'auth'

export type CatalogProductAiCategorizeSummary = {
  processedCount: number
  suggestedCount: number
  noMatchCount: number
  failedCount: number
  failedItems: CatalogProductAiCategorizeFailure[]
  stoppedReason?: CatalogProductAiCategorizeStopReason
}

export function resolveAiCategorizeConcurrency(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

export function buildAiCategorizeCommandContext(
  scope: CatalogProductAiCategorizeScope,
  container: AwilixContainer,
): CommandRuntimeContext {
  if (!scope.tenantId || !scope.organizationId || !scope.userId) {
    throw new Error('[internal] Catalog AI categorization requires tenant, organization and user scope')
  }
  return {
    container,
    auth: {
      sub: scope.userId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      isSuperAdmin: false,
    },
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

export type CategorizeProductsDeps = {
  suggester?: ProductSuggester
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function categorizeProductsWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  ids: string[]
  scope: CatalogProductAiCategorizeScope
  deps?: CategorizeProductsDeps
}): Promise<CatalogProductAiCategorizeSummary> {
  const { container, progressJobId, ids, scope } = params
  const sleep = params.deps?.sleep ?? defaultSleep
  const progressService = container.resolve('progressService') as ProgressService
  const categorizationService = container.resolve('catalogCategorizationService') as CatalogCategorizationService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }
  const commandContext = buildAiCategorizeCommandContext(scope, container)
  const suggester =
    params.deps?.suggester ??
    createProductSuggester({
      container,
      scope: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: commandContext.auth?.sub ?? scope.userId ?? '',
      },
    })

  await progressService.startJob(progressJobId, progressContext)
  await progressService.updateProgress(progressJobId, { totalCount: ids.length, processedCount: 0 }, progressContext)

  const summary: CatalogProductAiCategorizeSummary = {
    processedCount: 0,
    suggestedCount: 0,
    noMatchCount: 0,
    failedCount: 0,
    failedItems: [],
  }

  const recordFailure = (productId: string, code: string) => {
    summary.failedCount += 1
    if (summary.failedItems.length < MAX_RECORDED_FAILURES) {
      summary.failedItems.push({ productId, code })
    }
  }

  const suggestSafely: ProductSuggester = async (productId, options) => {
    try {
      return await suggester(productId, options)
    } catch (error) {
      if (isCrudHttpError(error)) {
        const code = typeof error.body?.code === 'string' ? error.body.code : `http_${error.status}`
        return { outcome: 'error', code }
      }
      return { outcome: 'error', code: 'internal_error' }
    }
  }

  const runWithPolicy = async (productId: string) => {
    let result = await suggestSafely(productId)
    if (result.outcome === 'error' && result.code === 'payload_too_large') {
      result = await suggestSafely(productId, { minimalState: true })
    } else if (result.outcome === 'error' && result.code === 'rate_limited') {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS)
      result = await suggestSafely(productId)
    }
    return result
  }

  for (const productId of ids) {
    const cancelled = await progressService.isCancellationRequested(
      progressJobId,
      scope.tenantId,
      scope.organizationId,
    )
    if (cancelled) {
      summary.stoppedReason = 'cancelled'
      await progressService.updateProgress(progressJobId, { meta: { resultSummary: summary } }, progressContext)
      await progressService.markCancelled(progressJobId, progressContext)
      return summary
    }

    const status = await categorizationService.getStatus({ tenantId: scope.tenantId })
    if (!status.effective) {
      summary.stoppedReason = 'feature_disabled'
      break
    }

    const result = await runWithPolicy(productId)
    if (result.outcome === 'error') {
      if (FAIL_FAST_CODES.has(result.code)) {
        summary.stoppedReason = result.code as CatalogProductAiCategorizeStopReason
        recordFailure(productId, result.code)
        await progressService.failJob(
          progressJobId,
          {
            errorMessage: `AI categorization stopped: ${result.code}`,
            resultSummary: summary,
          },
          progressContext,
        )
        return summary
      }
      recordFailure(productId, result.code)
    } else if (result.outcome === 'suggested') {
      summary.suggestedCount += 1
    } else {
      summary.noMatchCount += 1
    }

    summary.processedCount += 1
    await progressService.updateProgress(
      progressJobId,
      { totalCount: ids.length, processedCount: summary.processedCount },
      progressContext,
    )
  }

  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}
