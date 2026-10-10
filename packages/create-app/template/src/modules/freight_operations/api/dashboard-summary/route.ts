import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { FreightService } from '../../lib/freightService'

export const metadata = {
  path: '/freight_operations/dashboard-summary',
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
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
    const service = container.resolve('freightService') as FreightService
    const summary = await service.getDashboardSummary({ tenantId: auth.tenantId, organizationId })
    return NextResponse.json(summary)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('freight_operations.errors.summary_failed', 'Unable to load the freight summary.') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Freight dashboard summary',
  methods: {
    GET: {
      summary: 'Return scoped order, trip, abstract, and receivables counters',
      responses: [{
        status: 200,
        description: 'Freight summary for the authenticated organization',
        schema: z.object({
          openOrders: z.number(),
          ordersAwaitingPod: z.number(),
          ordersAwaitingInvoice: z.number(),
          invoicedOrders: z.number(),
          unbilledTrips: z.number(),
          abstractsAwaitingCustomer: z.number(),
          approvedNotInvoiced: z.number(),
          overdueInvoices: z.number(),
          outstandingAmount: z.string(),
        }),
      }],
    },
  },
}
