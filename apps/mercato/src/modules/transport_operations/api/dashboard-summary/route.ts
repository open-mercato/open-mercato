import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TransportService } from '../../lib/transportService'

export const metadata = {
  path: '/transport/dashboard-summary',
  GET: { requireAuth: true, requireFeatures: ['transport.read'] },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const service = container.resolve('transportService') as TransportService
    const summary = await service.getDashboardSummary({ tenantId: auth.tenantId, organizationId })
    return NextResponse.json(summary)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('transport_operations.errors.summary_failed', 'Unable to load transport summary') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Transport Operations',
  summary: 'Transport dashboard summary',
  methods: {
    GET: {
      summary: 'Return scoped fleet, driver, and trip counts',
      responses: [{
        status: 200,
        description: 'Transport summary for the authenticated organization',
        schema: z.object({
          activeVehicles: z.number(), availableDrivers: z.number(), expiringDriverLicenses: z.number(),
          scheduledTrips: z.number(), tripsInProgress: z.number(),
        }),
      }],
    },
  },
}
