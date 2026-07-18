import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { StockMovement } from '../../../data/entities.js'
import { stockMovementsListQuerySchema } from '../../../data/validators.js'
import { createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi.js'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.stock.view'] },
}

/** Movement history for a product (+variant), used by the storno UX to find
 * the movement id to reverse (task 2.2). */
export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = stockMovementsListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const where: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      productId: query.productId,
    }
    if (query.variantId) where.variantId = query.variantId

    const page = query.page
    const pageSize = query.pageSize
    const [movements, total] = await em.findAndCount(StockMovement, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      items: movements.map((m) => ({
        id: m.id,
        movementType: m.movementType,
        productId: m.productId,
        variantId: m.variantId ?? null,
        batchId: m.batchId ?? null,
        qty: Number(m.qty),
        uom: m.uom,
        sourceType: m.sourceType,
        sourceId: m.sourceId ?? null,
        reversesMovementId: m.reversesMovementId ?? null,
        createdAt: m.createdAt.toISOString(),
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
      { error: translate('production.errors.stock_movements_failed', 'Failed to load stock movements.') },
      { status: 400 },
    )
  }
}

const movementSchema = z.object({
  id: z.string().uuid(),
  movementType: z.enum(['receipt', 'issue', 'adjustment']),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  batchId: z.string().uuid().nullable(),
  qty: z.number(),
  uom: z.string(),
  sourceType: z.enum(['order', 'report', 'import', 'manual']),
  sourceId: z.string().uuid().nullable(),
  reversesMovementId: z.string().uuid().nullable(),
  createdAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'List production stock movements',
  methods: {
    GET: {
      operationId: 'listProductionStockMovements',
      summary: 'List stock movement history for a product',
      description: 'Returns the append-only movement ledger for a product (+variant), most recent first.',
      responses: [{ status: 200, description: 'Movements', schema: createPagedListResponseSchema(movementSchema) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
