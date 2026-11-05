import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogProductCategory, type CatalogCategorySuggestionTrigger } from '../../data/entities'
import { emitCatalogEvent } from '../../events'
import { computeHierarchyForCategories } from '../categoryHierarchy'
import { maybeAutoApplySuggestion } from './autoApply'
import { CATALOG_AI_CATEGORIZATION_MODULE_ID, type CatalogCategorizationService } from './categorizationService'
import type { CatalogDecisionModelPort } from './decisionModelPort'
import { buildProductState } from './productState'
import { serializeCategorySuggestion } from './serializeSuggestion'
import { persistCategorySuggestion } from './suggestionPersistence'
import {
  CATEGORIZATION_PROMPT_VERSION,
  walkCategoryTree,
  type TreeWalkCategory,
} from './treeWalk'

const logger = createLogger('catalog')

export type ProductSuggestionScope = {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export type ProductSuggestionOutcome =
  | { outcome: 'suggested' | 'no_match' }
  | { outcome: 'error'; code: string }

export type ProductSuggestionOptions = {
  minimalState?: boolean
}

export type ProductSuggester = (
  productId: string,
  options?: ProductSuggestionOptions,
) => Promise<ProductSuggestionOutcome>

function resolvePort(container: AwilixContainer): CatalogDecisionModelPort | null {
  try {
    return container.resolve('decisionModelService') as CatalogDecisionModelPort
  } catch {
    return null
  }
}

export function createProductSuggester(params: {
  container: AwilixContainer
  scope: ProductSuggestionScope
  commandContext?: CommandRuntimeContext
  trigger?: CatalogCategorySuggestionTrigger
}): ProductSuggester {
  const { container, scope, commandContext } = params
  const trigger = params.trigger ?? 'bulk'
  const em = (container.resolve('em') as EntityManager).fork()
  let tree: { roots: TreeWalkCategory[]; childrenOf: (categoryId: string) => TreeWalkCategory[] } | null = null

  const loadTree = async () => {
    if (tree) return tree
    const categories = await em.find(CatalogProductCategory, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      isActive: true,
    })
    const hierarchy = computeHierarchyForCategories(categories)
    const toTreeWalkCategory = (node: { id: string; name: string; pathLabel: string }): TreeWalkCategory => ({
      id: node.id,
      name: node.name,
      pathLabel: node.pathLabel,
    })
    tree = {
      roots: hierarchy.ordered.filter((node) => node.parentId === null).map(toTreeWalkCategory),
      childrenOf: (categoryId) => {
        const node = hierarchy.map.get(categoryId)
        if (!node) return []
        return node.childIds
          .map((childId) => hierarchy.map.get(childId))
          .filter((child): child is NonNullable<typeof child> => !!child)
          .map(toTreeWalkCategory)
      },
    }
    return tree
  }

  return async (productId, options) => {
    const port = resolvePort(container)
    if (!port) return { outcome: 'error', code: 'unavailable' }

    const fullState = await buildProductState(em, {
      productId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!fullState) return { outcome: 'error', code: 'product_not_found' }
    const productState = options?.minimalState ? { ...fullState, description: null, custom: {} } : fullState

    const { roots, childrenOf } = await loadTree()
    const startedAt = Date.now()
    const walkResult = await walkCategoryTree({
      port,
      productId,
      productState,
      roots,
      childrenOf,
      moduleId: CATALOG_AI_CATEGORIZATION_MODULE_ID,
    })
    if (walkResult.outcome === 'error') return { outcome: 'error', code: walkResult.code }
    const durationMs = Date.now() - startedAt

    const availability = port.getAvailability({ moduleId: CATALOG_AI_CATEGORIZATION_MODULE_ID })
    const suggestion = await persistCategorySuggestion(em, {
      productId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      outcome: walkResult.outcome,
      categoryId: walkResult.outcome === 'suggested' ? walkResult.categoryId : null,
      categoryPathIds: walkResult.outcome === 'suggested' ? walkResult.categoryPathIds : [],
      confidence: walkResult.outcome === 'suggested' ? walkResult.confidence : null,
      levels: walkResult.outcome === 'suggested' ? walkResult.levels : [],
      trigger,
      provider: availability.provider ?? null,
      model: availability.model ?? null,
      promptVersion: CATEGORIZATION_PROMPT_VERSION,
      durationMs,
      requestedByUserId: scope.userId ?? null,
    })
    const serialized = serializeCategorySuggestion(suggestion)
    await emitCatalogEvent(
      'catalog.category_suggestion.created',
      {
        id: serialized.id,
        productId: serialized.productId,
        categoryId: serialized.categoryId,
        status: serialized.status,
        confidence: serialized.confidence,
      },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (commandContext && walkResult.outcome === 'suggested') {
      try {
        const categorizationService = container.resolve('catalogCategorizationService') as CatalogCategorizationService
        const { settings } = await categorizationService.getStatus({ tenantId: scope.tenantId })
        await maybeAutoApplySuggestion({
          container,
          em,
          suggestion,
          trigger,
          settings,
          commandContext,
        })
      } catch (err) {
        logger.error('catalog.ai_categorization.auto_apply settings lookup failed', { err, suggestionId: suggestion.id })
        getTelemetryRuntime()?.reportError(err, {
          module: 'catalog',
          code: 'catalog.ai_categorization_auto_apply_lookup_failed',
        })
      }
    }
    return { outcome: walkResult.outcome }
  }
}
