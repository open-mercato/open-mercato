import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CHARGE_KINDS, FreightTripCharge } from '../../../data/entities'

export const metadata = {
  path: '/freight_operations/trips/charges',
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

    const url = new URL(req.url)
    const tripId = url.searchParams.get('tripId')
    if (!tripId) throw new CrudHttpError(400, { error: translate('freight_operations.errors.trip_id_required', 'A trip id is required.') })

    const em = (container.resolve('em') as EntityManager).fork()
    const where: FilterQuery<FreightTripCharge> = {
      tenantId: auth.tenantId,
      organizationId,
      trip: tripId,
      deletedAt: null,
    }
    const rows = await em.find(FreightTripCharge, where, { orderBy: { position: 'asc', createdAt: 'asc' } })
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        description: row.description ?? null,
        quantity: row.quantity,
        unit_amount_net: row.unitAmountNet,
        amount_net: row.amountNet,
        is_taxable: row.isTaxable,
        billable: row.billable,
        position: row.position,
        updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('freight_operations.errors.charges_load_failed', 'Unable to load trip charges.') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Trip charge lines',
  methods: {
    GET: {
      summary: 'List the extra charges recorded on one trip',
      responses: [{
        status: 200,
        description: 'Charge lines for the trip',
        schema: z.object({
          items: z.array(z.object({
            id: z.string().uuid(),
            kind: z.enum(CHARGE_KINDS),
            description: z.string().nullable(),
            quantity: z.string(),
            unit_amount_net: z.string(),
            amount_net: z.string(),
            is_taxable: z.boolean(),
            billable: z.boolean(),
            position: z.number(),
          })),
        }),
      }],
    },
  },
}
