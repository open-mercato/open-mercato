import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  listTransportDrivers,
  listTransportRoutes,
  listTransportVehicles,
} from '../../../lib/transportReference'

export const metadata = {
  path: '/freight_operations/reference/transport',
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
}

/**
 * Fleet master data for the freight pickers. Tolerant by design: with
 * transport_operations disabled every list comes back empty (`available:
 * false`) and the forms fall back to manual entry.
 */
export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })

    const em = (container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: auth.tenantId, organizationId }
    const [vehicles, drivers, routes] = await Promise.all([
      listTransportVehicles(em, scope),
      listTransportDrivers(em, scope),
      listTransportRoutes(em, scope),
    ])
    const available = vehicles !== null || drivers !== null || routes !== null
    return NextResponse.json({
      available,
      vehicles: vehicles ?? [],
      drivers: drivers ?? [],
      routes: routes ?? [],
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('freight_operations.errors.reference_load_failed', 'Unable to load the fleet reference.') }, { status: 500 })
  }
}

const vehicleSchema = z.object({
  id: z.string().uuid(),
  plateNumber: z.string(),
  make: z.string(),
  model: z.string(),
  status: z.string(),
})
const driverSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  status: z.string(),
  licenseNumber: z.string(),
  licenseExpiry: z.string().nullable(),
})
const routeSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  startLocation: z.string(),
  endLocation: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Fleet reference data for freight pickers',
  methods: {
    GET: {
      summary: 'Vehicles, drivers, and routes from transport_operations (empty when the module is disabled)',
      responses: [{
        status: 200,
        description: 'Reference lists',
        schema: z.object({
          available: z.boolean(),
          vehicles: z.array(vehicleSchema),
          drivers: z.array(driverSchema),
          routes: z.array(routeSchema),
        }),
      }],
    },
  },
}
