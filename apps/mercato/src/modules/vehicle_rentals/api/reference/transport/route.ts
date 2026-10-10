import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listTransportDrivers, listTransportVehicles } from '../../../lib/transportReference'

export const metadata = {
  path: '/vehicle_rentals/reference/transport',
  GET: { requireAuth: true, requireFeatures: ['rentals.read'] },
}

/**
 * Fleet pickers for the rental screens, read tolerantly: `available: false` says
 * the fleet module is absent, and the screens fall back to manual entry rather
 * than failing.
 */
export async function GET(req: Request): Promise<Response> {
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
    const [vehicles, drivers] = await Promise.all([
      listTransportVehicles(em, scope),
      listTransportDrivers(em, scope),
    ])
    return NextResponse.json({
      available: vehicles !== null,
      vehicles: vehicles ?? [],
      drivers: drivers ?? [],
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Unable to load the fleet reference.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Fleet master data for the rental pickers',
  methods: {
    GET: {
      summary: 'List rentable vehicles and drivers; degrades to empty lists when the fleet module is absent',
      responses: [{
        status: 200,
        description: 'Fleet reference',
        schema: z.object({
          available: z.boolean(),
          vehicles: z.array(z.object({
            id: z.string(),
            plateNumber: z.string(),
            make: z.string(),
            model: z.string(),
            status: z.string(),
          })),
          drivers: z.array(z.object({
            id: z.string(),
            fullName: z.string(),
            phone: z.string(),
            status: z.string(),
            licenseNumber: z.string(),
            licenseExpiry: z.string().nullable(),
          })),
        }),
      }],
    },
  },
}
