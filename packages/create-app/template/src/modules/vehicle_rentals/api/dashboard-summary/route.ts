import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  path: '/vehicle_rentals/dashboard-summary',
  GET: { requireAuth: true, requireFeatures: ['rentals.read'] },
}

/**
 * The rental operating picture: what is out on hire right now, what is due back
 * today, what closed this month, and the mileage revenue the completed rentals
 * carried. One query per figure, all tenant/org scoped.
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
    const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
      `
        select
          count(*) filter (where status = 'draft') as draft_rentals,
          count(*) filter (where status = 'active') as active_rentals,
          count(*) filter (where status = 'active' and end_at is not null and end_at::date <= current_date) as due_back,
          count(*) filter (where status = 'completed' and return_at >= date_trunc('month', current_date)) as completed_this_month,
          coalesce(sum(total_gross_amount) filter (where status = 'completed' and return_at >= date_trunc('month', current_date)), 0) as month_gross,
          coalesce(sum(extra_km_amount_net) filter (where status = 'completed' and return_at >= date_trunc('month', current_date)), 0) as month_extra_km_net
        from rental_contracts
        where tenant_id = ? and organization_id = ? and deleted_at is null
      `,
      [auth.tenantId, organizationId],
    )
    const row = rows[0] ?? {}
    return NextResponse.json({
      draftRentals: Number(row.draft_rentals ?? 0),
      activeRentals: Number(row.active_rentals ?? 0),
      dueBack: Number(row.due_back ?? 0),
      completedThisMonth: Number(row.completed_this_month ?? 0),
      monthGross: String(row.month_gross ?? '0'),
      monthExtraKmNet: String(row.month_extra_km_net ?? '0'),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Unable to load the rental summary.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Rental dashboard summary',
  methods: {
    GET: {
      summary: 'Open rentals, rentals due back, and this month’s completed revenue',
      responses: [{
        status: 200,
        description: 'Rental counters',
        schema: z.object({
          draftRentals: z.number(),
          activeRentals: z.number(),
          dueBack: z.number(),
          completedThisMonth: z.number(),
          monthGross: z.string(),
          monthExtraKmNet: z.string(),
        }),
      }],
    },
  },
}
