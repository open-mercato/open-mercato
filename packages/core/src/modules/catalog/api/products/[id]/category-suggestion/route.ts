import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CatalogCategorizationService } from '../../../../lib/aiCategorization/categorizationService'
import type { CatalogDecisionModelPort } from '../../../../lib/aiCategorization/decisionModelPort'
import { buildProductState } from '../../../../lib/aiCategorization/productState'
import { walkCategoryTree, CATEGORIZATION_PROMPT_VERSION, type TreeWalkCategory } from '../../../../lib/aiCategorization/treeWalk'
import { persistCategorySuggestion } from '../../../../lib/aiCategorization/suggestionPersistence'
import { serializeCategorySuggestion } from '../../../../lib/aiCategorization/serializeSuggestion'
import { CatalogProductCategory } from '../../../../data/entities'
import { computeHierarchyForCategories } from '../../../../lib/categoryHierarchy'
import { emitCatalogEvent } from '../../../../events'

const logger = createLogger('catalog')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['catalog.ai_categorization.use'] },
}

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

const paramsSchema = z.object({ id: z.string().uuid() })

function resolvePort(container: Awaited<ReturnType<typeof createRequestContainer>>): CatalogDecisionModelPort | null {
  try {
    return container.resolve('decisionModelService') as CatalogDecisionModelPort
  } catch {
    return null
  }
}

export async function POST(req: Request, routeContext: RouteContext) {
  try {
    const { id: productId } = paramsSchema.parse(await routeContext.params)
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = auth.tenantId
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()

    const container = await createRequestContainer()
    const categorizationService = container.resolve('catalogCategorizationService') as CatalogCategorizationService
    const status = await categorizationService.getStatus({ tenantId })
    if (!status.effective) {
      return NextResponse.json({ code: 'ai_categorization_unavailable', reason: status.reason ?? null }, { status: 409 })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const productState = await buildProductState(em, { productId, tenantId, organizationId })
    if (!productState) {
      throw new CrudHttpError(404, { error: 'Catalog product not found' })
    }

    const categories = await em.find(CatalogProductCategory, {
      organizationId,
      tenantId,
      deletedAt: null,
      isActive: true,
    })
    const hierarchy = computeHierarchyForCategories(categories)
    const toTreeWalkCategory = (node: { id: string; name: string; pathLabel: string }): TreeWalkCategory => ({
      id: node.id,
      name: node.name,
      pathLabel: node.pathLabel,
    })
    const roots = hierarchy.ordered.filter((node) => node.parentId === null).map(toTreeWalkCategory)
    const childrenOf = (categoryId: string): TreeWalkCategory[] => {
      const node = hierarchy.map.get(categoryId)
      if (!node) return []
      return node.childIds
        .map((childId) => hierarchy.map.get(childId))
        .filter((child): child is NonNullable<typeof child> => !!child)
        .map(toTreeWalkCategory)
    }

    const port = resolvePort(container)
    if (!port) {
      return NextResponse.json({ outcome: 'error', code: 'unavailable' }, { status: 200 })
    }

    const startedAt = Date.now()
    const walkResult = await walkCategoryTree({
      port,
      productId,
      productState,
      roots,
      childrenOf,
      moduleId: 'catalog',
    })
    const durationMs = Date.now() - startedAt

    if (walkResult.outcome === 'error') {
      return NextResponse.json({ outcome: 'error', code: walkResult.code }, { status: 200 })
    }

    const availability = port.getAvailability({ moduleId: 'catalog' })
    const suggestion = await persistCategorySuggestion(em, {
      productId,
      tenantId,
      organizationId,
      outcome: walkResult.outcome,
      categoryId: walkResult.outcome === 'suggested' ? walkResult.categoryId : null,
      categoryPathIds: walkResult.outcome === 'suggested' ? walkResult.categoryPathIds : [],
      confidence: walkResult.outcome === 'suggested' ? walkResult.confidence : null,
      levels: walkResult.outcome === 'suggested' ? walkResult.levels : [],
      trigger: 'manual',
      provider: availability.provider ?? null,
      model: availability.model ?? null,
      promptVersion: CATEGORIZATION_PROMPT_VERSION,
      durationMs,
      requestedByUserId: auth.sub ?? null,
    })

    const serialized = serializeCategorySuggestion(suggestion)
    await emitCatalogEvent('catalog.category_suggestion.created', {
      id: serialized.id,
      productId: serialized.productId,
      categoryId: serialized.categoryId,
      status: serialized.status,
      confidence: serialized.confidence,
    }, { tenantId, organizationId })

    return NextResponse.json({ suggestion: serialized }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.ai_categorization.category_suggestion.POST Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const suggestionSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  outcome: z.string(),
  categoryId: z.string().uuid().nullable(),
  categoryPathIds: z.array(z.string().uuid()),
  confidence: z.number().nullable(),
  status: z.string(),
  updatedAt: z.string(),
})

const postDoc: OpenApiMethodDoc = {
  summary: 'Suggest a category for a product via the decision model port',
  tags: ['Catalog'],
  responses: [
    { status: 201, description: 'Suggestion created', schema: z.object({ suggestion: suggestionSchema }) },
    { status: 200, description: 'Decision model port error', schema: z.object({ outcome: z.literal('error'), code: z.string() }) },
  ],
  errors: [
    { status: 404, description: 'Product not found' },
    { status: 409, description: 'AI categorization unavailable (platform or tenant gate closed)' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog AI category suggestion (single product)',
  methods: { POST: postDoc },
}
