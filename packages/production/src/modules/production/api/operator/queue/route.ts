import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { ProductionOrder, ProductionOrderOperation } from '../../../data/entities.js'
import { selectOperatorQueue } from '../../../lib/operatorQueue.js'

const queryQuerySchema = z.object({ workCenterId: z.string().uuid('workCenterId is required') })

/**
 * Operator work queue (task 4.3, spec § API Contracts: `production.operator.view`).
 * Joins released/in_progress order header rows with reporting-point
 * operations for a single work center, tenant/org scoped — the
 * join/filter/sort logic itself lives in the pure, unit-tested
 * `selectOperatorQueue` (lib/operatorQueue.ts).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.operator.view'] },
}

export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = queryQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    const tenantId = ctx.auth?.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: translate('production.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const em = ctx.container.resolve<EntityManager>('em')
    const orgScopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const operations = await em.find(
      ProductionOrderOperation,
      {
        tenantId,
        ...orgScopeFilter,
        workCenterId: query.workCenterId,
        isReportingPoint: true,
        status: { $in: ['pending', 'in_progress'] },
        deletedAt: null,
      },
      { orderBy: { sequence: 'ASC' } },
    )

    const orderIds = Array.from(new Set(operations.map((operation) => operation.orderId)))
    const orders = orderIds.length
      ? await em.find(ProductionOrder, {
          id: { $in: orderIds },
          tenantId,
          ...orgScopeFilter,
          status: { $in: ['released', 'in_progress'] },
          deletedAt: null,
        })
      : []

    const items = selectOperatorQueue(
      orders.map((order) => ({
        id: order.id,
        number: order.number,
        productId: order.productId,
        variantId: order.variantId ?? null,
        qtyPlanned: order.qtyPlanned,
        status: order.status,
        updatedAt: order.updatedAt.toISOString(),
      })),
      operations.map((operation) => ({
        id: operation.id,
        orderId: operation.orderId,
        sequence: operation.sequence,
        name: operation.name,
        workCenterId: operation.workCenterId,
        isReportingPoint: operation.isReportingPoint,
        status: operation.status,
      })),
      query.workCenterId,
    )

    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json(
      { error: translate('production.operator.error.queue_load_failed', 'Failed to load the operator work queue.') },
      { status: 400 },
    )
  }
}

const queueItemSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.number(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  qtyPlanned: z.string(),
  orderUpdatedAt: z.string(),
  operationId: z.string().uuid(),
  sequence: z.number(),
  name: z.string(),
  operationStatus: z.enum(['pending', 'in_progress']),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Operator work queue',
  methods: {
    GET: {
      operationId: 'getProductionOperatorQueue',
      summary: 'List reporting-point operations pending report for a work center',
      description: 'Returns released/in_progress order operations that are reporting points on the given work center, for the operator lite panel.',
      responses: [{ status: 200, description: 'Queue items', schema: z.object({ items: z.array(queueItemSchema) }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
