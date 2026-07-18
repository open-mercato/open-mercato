import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../organizationScopeFilter.js'
import { StockItem, StockBatch } from '../../data/entities.js'
import { stockListQuerySchema } from '../../data/validators.js'
import { createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi.js'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.stock.view'] },
}

/**
 * Read-only stock-on-hand projection (task 2.2). Not a `makeCrudRoute` list —
 * a plain `StockItem` row list has no batch count / reserved-vs-available
 * summary a caller of this endpoint actually needs, so this is a small
 * custom GET (mirrors the `cost-rollup` route's pattern: `actionRouteContext`
 * + `organizationScopeFilter` + a hand-rolled response shape) rather than
 * forcing the generic list factory to do a join it wasn't built for.
 */
export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = stockListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const where: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      deletedAt: null,
    }
    if (query.productId) where.productId = query.productId
    if (query.variantId) where.variantId = query.variantId

    const page = query.page
    const pageSize = query.pageSize
    const [items, total] = await em.findAndCount(StockItem, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { updatedAt: 'desc' },
    })

    const stockItemIds = items.map((item) => item.id)
    const batchCounts = new Map<string, number>()
    if (stockItemIds.length > 0) {
      const batches = await em.find(StockBatch, { stockItemId: { $in: stockItemIds }, deletedAt: null })
      for (const batch of batches) {
        batchCounts.set(batch.stockItemId, (batchCounts.get(batch.stockItemId) ?? 0) + 1)
      }
    }

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
        uom: item.uom,
        onHand: Number(item.onHand),
        reserved: Number(item.reserved),
        available: Number(item.onHand) - Number(item.reserved),
        batchCount: batchCounts.get(item.id) ?? 0,
        updatedAt: item.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.stock_list_failed', 'Failed to load stock items.') },
      { status: 400 },
    )
  }
}

const stockItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  uom: z.string(),
  onHand: z.number(),
  reserved: z.number(),
  available: z.number(),
  batchCount: z.number(),
  updatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'List production stock items',
  methods: {
    GET: {
      operationId: 'listProductionStock',
      summary: 'List production stock on-hand',
      description: 'Returns on-hand/reserved/available quantities per product (+variant), scoped to the authenticated organization.',
      responses: [
        { status: 200, description: 'Stock items', schema: createPagedListResponseSchema(stockItemSchema) },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
