import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  operationalDashboardQuerySchema,
  operationalDashboardResponseSchema,
} from '../../../data/validators'
import {
  loadOperationalDashboard,
  OperationalDashboardWarehouseNotFoundError,
} from '../../../lib/loadOperationalDashboard'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const parsedQuery = operationalDashboardQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const organizationScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request,
    })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const payload = await loadOperationalDashboard(em, {
      organizationId,
      tenantId: auth.tenantId,
      warehouseId: parsedQuery.warehouseId ?? null,
    })

    return NextResponse.json(operationalDashboardResponseSchema.parse(payload))
  } catch (error) {
    if (error instanceof OperationalDashboardWarehouseNotFoundError) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
    }
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    console.error('[wms.dashboard] GET operational failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Operational dashboard',
  description:
    'Aggregated KPIs, expiry watch lot rows (`expiryLots`), monthly movement trends, and recent activity for the WMS operational dashboard.',
  methods: {
    GET: {
      summary: 'Load operational dashboard data',
      query: operationalDashboardQuerySchema,
      responses: [
        { status: 200, description: 'Dashboard payload', schema: operationalDashboardResponseSchema },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Warehouse not found' },
      ],
    },
  },
}
