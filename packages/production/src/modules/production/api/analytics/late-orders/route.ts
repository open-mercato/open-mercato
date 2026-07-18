import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { ProductionOrder } from '../../../data/entities.js'
import { analyticsLateOrdersQuerySchema } from '../../../data/validators.js'
import { createPagedListResponseSchema } from '../../openapi.js'
import { classifyLateAtRiskOrders } from '../../../lib/reports/lateOrders.js'

/**
 * Late/at-risk orders (task 6.1, spec § Scope: "MVP reports (ilościowe,
 * bez wyceny): zlecenia opóźnione/zagrożone"). Named under a distinct
 * `api/analytics/*` prefix (not `api/reports/*`) because
 * `api/reports/route.ts` already owns the shop-floor `ProductionReport`
 * submission/list surface (task 4.1) — reusing that prefix for the
 * analytics endpoints would collide in the OpenAPI operation namespace.
 * Gated on `production.reports.view` (read-only oversight feature, already
 * declared in `acl.ts`), same as the shop-floor reports list.
 *
 * Only `released`/`in_progress` orders can ever be late/at-risk — the
 * classification query filters by status directly (the pure
 * `classifyLateAtRiskOrders` function in `lib/reports/lateOrders.ts`
 * re-asserts this defensively so unit tests can also exercise the
 * status-exclusion boundary without a DB).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.reports.view'] },
}

export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = analyticsLateOrdersQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const orders = await em.find(ProductionOrder, {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      status: { $in: ['released', 'in_progress'] },
      deletedAt: null,
    })

    const classified = classifyLateAtRiskOrders(
      orders.map((order) => ({
        id: order.id,
        number: order.number,
        productId: order.productId,
        variantId: order.variantId ?? null,
        qtyPlanned: order.qtyPlanned,
        qtyCompleted: order.qtyCompleted,
        dueDate: order.dueDate ?? null,
        status: order.status,
      })),
      { now: new Date(), atRiskDays: query.atRiskDays },
    ).sort((a, b) => {
      if (a.classification !== b.classification) return a.classification === 'late' ? -1 : 1
      return a.daysUntilDue - b.daysUntilDue
    })

    const total = classified.length
    const page = query.page
    const pageSize = query.pageSize
    const items = classified.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

    return NextResponse.json({ items, total, page, pageSize })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.analytics_late_orders_failed', 'Failed to load late/at-risk orders.') },
      { status: 400 },
    )
  }
}

const lateOrderSchema = z.object({
  id: z.string().uuid(),
  number: z.number(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  qtyPlanned: z.number(),
  qtyCompleted: z.number(),
  remainingQty: z.number(),
  dueDate: z.string(),
  status: z.string(),
  classification: z.enum(['late', 'at_risk']),
  daysLate: z.number(),
  daysUntilDue: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Production analytics — late/at-risk orders',
  methods: {
    GET: {
      operationId: 'listProductionLateAtRiskOrders',
      summary: 'List released/in-progress production orders that are late or at risk of being late',
      description:
        'Quantity-based MVP report (no valuation). "Late": due date already passed with remaining planned quantity. "At risk": due date within `atRiskDays` (default 7) with remaining planned quantity.',
      responses: [{ status: 200, description: 'Late/at-risk orders', schema: createPagedListResponseSchema(lateOrderSchema) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
