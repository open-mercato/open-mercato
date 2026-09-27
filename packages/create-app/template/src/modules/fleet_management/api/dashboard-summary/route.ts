import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { FleetService } from '../../lib/fleetService'

const logger = createLogger('fleet_management')

export const metadata = {
  path: '/fleet_management/dashboard-summary',
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
}

const summarySchema = z.object({
  activeVehicles: z.number().int(),
  assignedVehicles: z.number().int(),
  vehiclesInMaintenance: z.number().int(),
  expiringDocuments: z.number().int(),
  activeAssignments: z.number().int(),
  overdueAssignments: z.number().int(),
})

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    }
    const service = container.resolve('fleetService') as FleetService
    const summary = await service.getDashboardSummary({ tenantId: auth.tenantId, organizationId })
    return NextResponse.json(summary)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    logger.error('fleet_management.dashboard_summary.failed', { err })
    return NextResponse.json(
      { error: translate('fleet_management.errors.record_not_found', 'Unable to load the fleet summary') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Fleet Management',
  summary: 'Fleet dashboard summary',
  methods: {
    GET: {
      summary: 'Vehicle, custody and document counters for the current organization',
      responses: [{ status: 200, description: 'Fleet counters', schema: summarySchema }],
    },
  },
}