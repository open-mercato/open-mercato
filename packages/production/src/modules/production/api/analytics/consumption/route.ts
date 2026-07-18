import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { ProductionOrder, ProductionOrderMaterial, ProductionOrderOperation } from '../../../data/entities.js'
import { analyticsConsumptionQuerySchema } from '../../../data/validators.js'
import {
  computeConsumptionVariance,
  aggregateConsumptionByProduct,
  resolveConsumedUnitsForMaterial,
} from '../../../lib/reports/consumption.js'

/**
 * Actual vs. standard consumption (quantities), task 6.1. "Standard" is
 * `ProductionOrderMaterial.qtyRequired` (material per ONE finished unit,
 * release-time snapshot) scaled to the SAME basis `lib/backflush.ts` uses
 * to compute `qtyIssued`: `qtyRequired * (1 + scrapFactor) * consumedUnits`
 * — see the doc comment in `lib/reports/consumption.ts` (review finding,
 * task 6.1 R1) for why a raw unscaled comparison against `qtyIssued` is
 * wrong. `consumedUnits` is resolved per material via
 * `resolveConsumedUnitsForMaterial`, which needs each order's
 * `ProductionOrderOperation` rows (loaded here in one batched, tenant/org
 * scoped query alongside the orders/materials).
 *
 * Only orders that were actually RELEASED (`releasedAt` set) can have a
 * material snapshot to compare, so the date-range filter applies to
 * `releasedAt`, not `createdAt`/`dueDate` — an order still in `draft`/
 * `planned` has no `ProductionOrderMaterial` rows yet.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.reports.view'] },
}

export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = analyticsConsumptionQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const orderWhere: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      releasedAt: { $ne: null },
      deletedAt: null,
    }
    if (query.dateFrom || query.dateTo) {
      const releasedAt: Record<string, Date> = {}
      if (query.dateFrom) releasedAt.$gte = query.dateFrom
      if (query.dateTo) releasedAt.$lte = query.dateTo
      orderWhere.releasedAt = releasedAt
    }

    const orders = await em.find(ProductionOrder, orderWhere)
    const orderNumberById = new Map(orders.map((order) => [order.id, order.number]))
    const orderIds = orders.map((order) => order.id)

    const materialWhere: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      orderId: { $in: orderIds },
      deletedAt: null,
    }
    if (query.productId) materialWhere.componentProductId = query.productId

    const materials = orderIds.length ? await em.find(ProductionOrderMaterial, materialWhere) : []

    const operationWhere: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      orderId: { $in: orderIds },
      deletedAt: null,
    }
    const operations = orderIds.length ? await em.find(ProductionOrderOperation, operationWhere) : []
    const operationsByOrder = new Map<string, typeof operations>()
    for (const operation of operations) {
      const bucket = operationsByOrder.get(operation.orderId) ?? []
      bucket.push(operation)
      operationsByOrder.set(operation.orderId, bucket)
    }

    const lines = computeConsumptionVariance(
      materials.map((material) => {
        const orderOperations = operationsByOrder.get(material.orderId) ?? []
        const consumedUnits = resolveConsumedUnitsForMaterial(
          material.operationSequence ?? null,
          orderOperations.map((operation) => ({
            sequence: operation.sequence,
            isReportingPoint: operation.isReportingPoint,
            qtyGood: operation.qtyGood,
            qtyScrap: operation.qtyScrap,
          })),
        )
        return {
          orderId: material.orderId,
          orderNumber: orderNumberById.get(material.orderId) ?? 0,
          componentProductId: material.componentProductId,
          componentVariantId: material.componentVariantId ?? null,
          qtyPerUnit: material.qtyRequired,
          scrapFactor: material.scrapFactor,
          qtyIssued: material.qtyIssued,
          consumedUnits,
        }
      }),
    )
    const productAggregates = aggregateConsumptionByProduct(lines)

    const total = lines.length
    const page = query.page
    const pageSize = query.pageSize
    const pagedLines = lines.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

    return NextResponse.json({ productAggregates, lines: pagedLines, total, page, pageSize })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.analytics_consumption_failed', 'Failed to load consumption report.') },
      { status: 400 },
    )
  }
}

const consumptionLineSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.number(),
  componentProductId: z.string().uuid(),
  componentVariantId: z.string().uuid().nullable(),
  standardQty: z.number(),
  actualQty: z.number(),
  varianceQty: z.number(),
  variancePct: z.number().nullable(),
})

const consumptionAggregateSchema = z.object({
  componentProductId: z.string().uuid(),
  componentVariantId: z.string().uuid().nullable(),
  standardQty: z.number(),
  actualQty: z.number(),
  varianceQty: z.number(),
  variancePct: z.number().nullable(),
  orderCount: z.number(),
})

const consumptionResponseSchema = z.object({
  productAggregates: z.array(consumptionAggregateSchema),
  lines: z.array(consumptionLineSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Production analytics — actual vs. standard consumption',
  methods: {
    GET: {
      operationId: 'getProductionConsumptionReport',
      summary: 'Actual vs. standard material consumption (quantities), aggregated per product with a per-order drill list',
      description:
        'Quantity-based MVP report (no valuation). Standard = qtyRequired (per-unit BOM snapshot) * (1 + scrapFactor) * consumedUnits (cumulative good+scrap reported against the material\'s backflush operation), matching the same basis lib/backflush.ts uses to compute the actual = qtyIssued side. Optionally filtered by releasedAt date range and componentProductId.',
      responses: [{ status: 200, description: 'Consumption variance report', schema: consumptionResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
