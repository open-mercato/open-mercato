import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  CatalogProduct,
  CatalogProductCategoryAssignment,
  CatalogProductCategorySuggestion,
} from '../../data/entities'
import { getCatalogQueue } from '../catalogQueue'
import { CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE } from './bulkCategorize'
import type { CatalogCategorizationService } from './categorizationService'
import { createProductSuggester, type ProductSuggester } from './suggestProduct'

const logger = createLogger('catalog')

export type CatalogProductAiCategorizeOnCreateJobPayload = {
  trigger: 'on_create'
  productId: string
  scope: {
    organizationId: string
    tenantId: string
  }
}

export type OnCreateSuggestionSkipReason =
  | 'feature_off'
  | 'product_not_found'
  | 'already_categorized'
  | 'already_suggested'

export type OnCreateSuggestionGate =
  | { proceed: true }
  | { proceed: false; reason: OnCreateSuggestionSkipReason }

export function isOnCreateJobPayload(payload: unknown): payload is CatalogProductAiCategorizeOnCreateJobPayload {
  return typeof payload === 'object' && payload !== null && (payload as { trigger?: unknown }).trigger === 'on_create'
}

export async function evaluateOnCreateGate(params: {
  container: AwilixContainer
  em: EntityManager
  productId: string
  tenantId: string
  organizationId: string
}): Promise<OnCreateSuggestionGate> {
  const { container, em, productId, tenantId, organizationId } = params
  const categorizationService = container.resolve('catalogCategorizationService') as CatalogCategorizationService
  const status = await categorizationService.getStatus({ tenantId })
  if (!status.effective || !status.settings.autoSuggestOnCreate) return { proceed: false, reason: 'feature_off' }

  const productCount = await em.count(CatalogProduct, { id: productId, tenantId, organizationId, deletedAt: null })
  if (productCount === 0) return { proceed: false, reason: 'product_not_found' }

  const assignmentCount = await em.count(CatalogProductCategoryAssignment, {
    product: productId,
    tenantId,
    organizationId,
  })
  if (assignmentCount > 0) return { proceed: false, reason: 'already_categorized' }

  const priorSuggestionCount = await em.count(CatalogProductCategorySuggestion, {
    product: productId,
    tenantId,
    organizationId,
    trigger: 'on_create',
  })
  if (priorSuggestionCount > 0) return { proceed: false, reason: 'already_suggested' }

  return { proceed: true }
}

/**
 * Subscriber-side entry: enqueues one suggestion-only job for a newly created
 * product when the tenant opted in. Never throws, so a failure can never reach
 * the product create path.
 */
export async function enqueueOnCreateSuggestion(params: {
  container: AwilixContainer
  productId: string
  tenantId: string
  organizationId: string
  enqueue?: (payload: CatalogProductAiCategorizeOnCreateJobPayload) => Promise<unknown>
}): Promise<OnCreateSuggestionGate | { proceed: false; reason: 'enqueue_failed' }> {
  const { container, productId, tenantId, organizationId } = params
  try {
    const em = (container.resolve('em') as EntityManager).fork()
    const gate = await evaluateOnCreateGate({ container, em, productId, tenantId, organizationId })
    if (!gate.proceed) return gate
    const payload: CatalogProductAiCategorizeOnCreateJobPayload = {
      trigger: 'on_create',
      productId,
      scope: { organizationId, tenantId },
    }
    const enqueue =
      params.enqueue ??
      ((job: CatalogProductAiCategorizeOnCreateJobPayload) =>
        getCatalogQueue(CATALOG_PRODUCT_AI_CATEGORIZE_QUEUE).enqueue(job))
    await enqueue(payload)
    return gate
  } catch (err) {
    logger.error('catalog.ai_categorization.on_create enqueue failed', { err, productId })
    return { proceed: false, reason: 'enqueue_failed' }
  }
}

/**
 * Worker-side entry: re-checks the gate (the feature may have been switched
 * off, the product categorized or deleted while the job waited) and runs one
 * suggestion with trigger `on_create`. No command context is built: this path
 * never applies a suggestion. Never throws.
 */
export async function runOnCreateSuggestion(params: {
  container: AwilixContainer
  payload: CatalogProductAiCategorizeOnCreateJobPayload
  suggester?: ProductSuggester
}): Promise<OnCreateSuggestionGate | { proceed: true; outcome: string }> {
  const { container, payload } = params
  const { productId, scope } = payload
  try {
    const em = (container.resolve('em') as EntityManager).fork()
    const gate = await evaluateOnCreateGate({
      container,
      em,
      productId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!gate.proceed) return gate
    const suggester =
      params.suggester ??
      createProductSuggester({
        container,
        scope: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: null },
        trigger: 'on_create',
      })
    const result = await suggester(productId)
    if (result.outcome === 'error') {
      logger.warn('catalog.ai_categorization.on_create suggestion failed', { productId, code: result.code })
    }
    return { proceed: true, outcome: result.outcome === 'error' ? result.code : result.outcome }
  } catch (err) {
    logger.error('catalog.ai_categorization.on_create run failed', { err, productId })
    return { proceed: true, outcome: 'internal_error' }
  }
}
