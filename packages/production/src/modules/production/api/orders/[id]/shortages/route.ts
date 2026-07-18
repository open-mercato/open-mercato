import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../../organizationScopeFilter.js'
import { ProductionOrder, ProductionOrderMaterial } from '../../../../data/entities.js'
import { computeCurrentShortages } from '../../../../lib/materialShortages.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.view'],
}

const shortageLineSchema = z.object({
  componentProductId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  qtyRequired: z.number(),
  qtyAvailable: z.number(),
  qtyShort: z.number(),
  uom: z.string(),
  reason: z.enum(['no_stock_item', 'uom_mismatch', 'insufficient_stock']),
})

const shortagesResponseSchema = z.object({
  lines: z.array(shortageLineSchema),
  computedAt: z.string(),
})

/**
 * Recomputes the material shortage list for an order on demand (spec §
 * API Contracts) — reflects CURRENT stock/reservation state, not a stored
 * snapshot from release time. See `lib/materialShortages.ts` doc for the
 * exact netting formula.
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

    const materials = await em.find(ProductionOrderMaterial, { orderId: order.id, ...orgScopeFilter, deletedAt: null })

    const lines = await computeCurrentShortages(
      em,
      { tenantId: order.tenantId, organizationId: order.organizationId },
      order.id,
      materials.map((m) => ({
        componentProductId: m.componentProductId,
        componentVariantId: m.componentVariantId ?? null,
        qtyRequired: m.qtyRequired,
        qtyIssued: m.qtyIssued,
        uom: m.uom,
      })),
    )

    return NextResponse.json({ lines, computedAt: new Date().toISOString() })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.order_shortages_failed', 'Failed to load material shortages for this order.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Get the current material shortage list for a production order',
  methods: {
    GET: {
      operationId: 'getProductionOrderShortages',
      summary: 'Recompute the material shortage list for a released production order',
      description:
        'Recomputes shortages on demand from CURRENT on-hand/reservation state (not a stored release-time snapshot): for each order material, the outstanding requirement (`qty_required - qty_issued`) net of this order\'s own active reservations, compared against truly free on-hand stock (`on_hand - reserved`).',
      responses: [
        { status: 200, description: 'Current material shortage list', schema: shortagesResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Production order not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
