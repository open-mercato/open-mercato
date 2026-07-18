import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { Routing, RoutingOperation } from '../../../data/entities.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.view'],
}

const routingDetailOperationSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number(),
  name: z.string(),
  workCenterId: z.string().uuid(),
  setupTimeMinutes: z.string(),
  runTimePerUnitSeconds: z.string(),
  isReportingPoint: z.boolean(),
})

const routingDetailSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  version: z.number(),
  status: z.enum(['draft', 'active', 'archived']),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  operations: z.array(routingDetailOperationSchema),
})

/**
 * Single-record routing detail, including operations (the `production.routings`
 * list endpoint is indexer-backed and only exposes header fields — the edit
 * page needs the full operations aggregate to hydrate the rows editor, see
 * task 1.3).
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
    const routing = await em.findOne(Routing, {
      id,
      tenantId,
      ...orgScopeFilter,
      deletedAt: null,
    })
    if (!routing) {
      return NextResponse.json({ error: translate('production.routings.error.not_found', 'Routing not found') }, { status: 404 })
    }

    const operations = await em.find(
      RoutingOperation,
      { routingId: routing.id, ...orgScopeFilter, deletedAt: null },
      { orderBy: { sequence: 'ASC' } },
    )

    return NextResponse.json({
      id: routing.id,
      productId: routing.productId,
      variantId: routing.variantId ?? null,
      version: routing.version,
      status: routing.status,
      name: routing.name,
      createdAt: routing.createdAt.toISOString(),
      updatedAt: routing.updatedAt.toISOString(),
      operations: operations.map((op) => ({
        id: op.id,
        sequence: op.sequence,
        name: op.name,
        workCenterId: op.workCenterId,
        setupTimeMinutes: op.setupTimeMinutes,
        runTimePerUnitSeconds: op.runTimePerUnitSeconds,
        isReportingPoint: op.isReportingPoint,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.routings.error.load_failed', 'Failed to load routing') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Get a routing by id (with operations)',
  methods: {
    GET: {
      operationId: 'getProductionRouting',
      summary: 'Get a routing by id, including its operations',
      description: 'Returns the full routing aggregate (header + operations) for the edit UI rows editor.',
      responses: [
        { status: 200, description: 'Routing detail with operations', schema: routingDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Routing not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
