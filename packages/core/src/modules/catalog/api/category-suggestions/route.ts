import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { parseIdsParam, mergeIdFilter } from '@open-mercato/shared/lib/crud/ids'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { categorySuggestionListQuerySchema } from '../../data/validators'
import { CatalogProductCategory, CatalogProductCategorySuggestion } from '../../data/entities'
import { serializeCategorySuggestion } from '../../lib/aiCategorization/serializeSuggestion'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = auth.tenantId
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()

    const url = new URL(req.url)
    const rawQuery = Object.fromEntries(url.searchParams)
    const parsed = categorySuggestionListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query', details: z.flattenError(parsed.error) }, { status: 400 })
    }
    const query = parsed.data
    // categorySuggestionListQuerySchema already caps pageSize at 100 (400 on a larger value).
    const pageSize = query.pageSize ?? 50
    const page = query.page ?? 1

    let where: Record<string, unknown> = {
      tenantId,
      organizationId,
      product: { deletedAt: null },
    }
    if (query.status) where.status = query.status
    if (query.productId) where.product = { ...(where.product as Record<string, unknown>), id: query.productId }
    if (query.minConfidence !== undefined) where.confidence = { $gte: query.minConfidence.toFixed(4) }
    const parsedIds = parseIdsParam(rawQuery.ids)
    where = mergeIdFilter(where, parsedIds, { idsParamProvided: typeof rawQuery.ids === 'string' })

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const [rows, total] = await Promise.all([
      em.find(CatalogProductCategorySuggestion, where, {
        populate: ['product'],
        orderBy: { createdAt: 'desc' },
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      em.count(CatalogProductCategorySuggestion, where),
    ])

    const categoryIds = Array.from(new Set(rows.map((row) => row.categoryId).filter((id): id is string => !!id)))
    const liveCategories = categoryIds.length
      ? await em.find(CatalogProductCategory, { id: { $in: categoryIds }, deletedAt: null, isActive: true })
      : []
    const liveCategoryIds = new Set(liveCategories.map((category) => category.id))

    const items = rows.map((row) => ({
      ...serializeCategorySuggestion(row),
      categoryLive: row.categoryId ? liveCategoryIds.has(row.categoryId) : false,
    }))

    return NextResponse.json({ items, page, pageSize, total })
  } catch (err) {
    logger.error('catalog.ai_categorization.category_suggestions.GET Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const suggestionItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  status: z.string(),
  categoryId: z.string().uuid().nullable(),
  categoryLive: z.boolean(),
  confidence: z.number().nullable(),
  updatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'List catalog AI category suggestions',
  methods: {
    GET: {
      summary: 'List category suggestions (read-only)',
      description: 'Filters: status, productId, ids, minConfidence. pageSize capped at 100. Hides suggestions of soft-deleted products and returns categoryLive computed from the category\'s deletedAt/isActive.',
      query: categorySuggestionListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Suggestions page',
          schema: z.object({
            items: z.array(suggestionItemSchema),
            page: z.number().int(),
            pageSize: z.number().int(),
            total: z.number().int(),
          }),
        },
      ],
    },
  },
}
