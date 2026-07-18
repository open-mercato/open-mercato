import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { ProductionOrder, ProductionOrderOperation, ProductionOrderMaterial, MaterialReservation } from '../../../data/entities.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.view'],
}

const orderOperationDetailSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number(),
  name: z.string(),
  workCenterId: z.string().uuid(),
  setupTimeMinutes: z.string(),
  runTimePerUnitSeconds: z.string(),
  isReportingPoint: z.boolean(),
  status: z.enum(['pending', 'in_progress', 'done']),
  qtyGood: z.string(),
  qtyScrap: z.string(),
  sourceOperationId: z.string().uuid().nullable(),
})

const orderMaterialDetailSchema = z.object({
  id: z.string().uuid(),
  operationSequence: z.number().nullable(),
  componentProductId: z.string().uuid(),
  componentVariantId: z.string().uuid().nullable(),
  qtyRequired: z.string(),
  uom: z.string(),
  scrapFactor: z.string(),
  qtyIssued: z.string(),
  sourceBomItemId: z.string().uuid().nullable(),
  reservedQty: z.number(),
})

const orderDetailSchema = z.object({
  id: z.string().uuid(),
  number: z.number(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  qtyPlanned: z.string(),
  uom: z.string(),
  dueDate: z.string().nullable(),
  priority: z.number(),
  status: z.enum(['draft', 'planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled']),
  sourceType: z.enum(['sales_order', 'mrp', 'manual']),
  sourceId: z.string().uuid().nullable(),
  bomVersionId: z.string().uuid().nullable(),
  routingVersionId: z.string().uuid().nullable(),
  releasedAt: z.string().nullable(),
  qtyCompleted: z.string(),
  qtyScrapped: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  operations: z.array(orderOperationDetailSchema),
  materials: z.array(orderMaterialDetailSchema),
})

/**
 * Single-record order detail, including operations + materials snapshot rows
 * (the `production.orders` list endpoint is indexer-backed and only exposes
 * header fields). `updatedAt` here is the token clients echo back via the
 * `x-om-ext-optimistic-lock-expected-updated-at` header on sub-resource
 * writes (spec § API Contracts: "sub-resources guarded by parent updated_at").
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const resolvedParams = await params
    const id = resolvedParams?.id
    if (!id) {
      return NextResponse.json({ error: translate('production.errors.id_required', 'Record id is required') }, { status: 400 })
    }

    const tenantId = ctx.auth?.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: translate('production.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const orgScopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const em = ctx.container.resolve<EntityManager>('em')
    const order = await em.findOne(ProductionOrder, {
      id,
      tenantId,
      ...orgScopeFilter,
      deletedAt: null,
    })
    if (!order) {
      return NextResponse.json({ error: translate('production.orders.error.not_found', 'Production order not found') }, { status: 404 })
    }

    const operations = await em.find(
      ProductionOrderOperation,
      { orderId: order.id, ...orgScopeFilter, deletedAt: null },
      { orderBy: { sequence: 'ASC' } },
    )
    const materials = await em.find(
      ProductionOrderMaterial,
      { orderId: order.id, ...orgScopeFilter, deletedAt: null },
      { orderBy: { createdAt: 'ASC' } },
    )

    // Current active reservations per order material (spec § UI: order
    // detail materials section shows "issued + current reservations"
    // alongside the release-time shortage snapshot). Additive field —
    // does not change any existing consumer's shape.
    const activeReservations = await em.find(MaterialReservation, {
      orderId: order.id,
      tenantId,
      status: 'active',
      ...orgScopeFilter,
      deletedAt: null,
    })
    const reservedByMaterialId = new Map<string, number>()
    for (const reservation of activeReservations) {
      if (!reservation.orderMaterialId) continue
      const current = reservedByMaterialId.get(reservation.orderMaterialId) ?? 0
      reservedByMaterialId.set(reservation.orderMaterialId, current + Number(reservation.qty))
    }

    return NextResponse.json({
      id: order.id,
      number: order.number,
      productId: order.productId,
      variantId: order.variantId ?? null,
      qtyPlanned: order.qtyPlanned,
      uom: order.uom,
      dueDate: order.dueDate ? order.dueDate.toISOString() : null,
      priority: order.priority,
      status: order.status,
      sourceType: order.sourceType,
      sourceId: order.sourceId ?? null,
      bomVersionId: order.bomVersionId ?? null,
      routingVersionId: order.routingVersionId ?? null,
      releasedAt: order.releasedAt ? order.releasedAt.toISOString() : null,
      qtyCompleted: order.qtyCompleted,
      qtyScrapped: order.qtyScrapped,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      operations: operations.map((op) => ({
        id: op.id,
        sequence: op.sequence,
        name: op.name,
        workCenterId: op.workCenterId,
        setupTimeMinutes: op.setupTimeMinutes,
        runTimePerUnitSeconds: op.runTimePerUnitSeconds,
        isReportingPoint: op.isReportingPoint,
        status: op.status,
        qtyGood: op.qtyGood,
        qtyScrap: op.qtyScrap,
        sourceOperationId: op.sourceOperationId ?? null,
      })),
      materials: materials.map((m) => ({
        id: m.id,
        operationSequence: m.operationSequence ?? null,
        componentProductId: m.componentProductId,
        componentVariantId: m.componentVariantId ?? null,
        qtyRequired: m.qtyRequired,
        uom: m.uom,
        scrapFactor: m.scrapFactor,
        qtyIssued: m.qtyIssued,
        sourceBomItemId: m.sourceBomItemId ?? null,
        reservedQty: reservedByMaterialId.get(m.id) ?? 0,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.orders.error.load_failed', 'Failed to load production order') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Get a production order by id (with operations and materials)',
  methods: {
    GET: {
      operationId: 'getProductionOrder',
      summary: 'Get a production order by id, including its released operations/materials snapshot',
      description: 'Returns the full order aggregate (header + operations + materials) for the detail UI.',
      responses: [
        { status: 200, description: 'Production order detail with operations and materials', schema: orderDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Production order not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
