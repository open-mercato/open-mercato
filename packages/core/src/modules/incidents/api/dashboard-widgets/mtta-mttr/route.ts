import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  getIncidentDashboardDb,
  incidentDashboardWidgetQuerySchema,
  readOptionalSeconds,
  resolveIncidentDashboardWidgetContext,
  uniqueOrganizationIds,
} from '../utils'

const MTTA_MTTR_WINDOW_DAYS = 30
const MTTA_MTTR_WINDOW_MS = MTTA_MTTR_WINDOW_DAYS * 24 * 60 * 60 * 1000

type MttaMttrRow = {
  mttaSeconds: string | number | null
  mttrSeconds: string | number | null
}

const mttaMttrResponseSchema = z.object({
  mttaSeconds: z.number().nullable(),
  mttrSeconds: z.number().nullable(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
})

const widgetErrorSchema = z.object({ error: z.string() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'incidents.incident.view'] },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds } = await resolveIncidentDashboardWidgetContext(req, translate)
    const db = getIncidentDashboardDb(em)
    const scopedOrganizationIds = uniqueOrganizationIds(organizationIds)
    const to = new Date()
    const from = new Date(to.getTime() - MTTA_MTTR_WINDOW_MS)

    let query = db
      .selectFrom('incidents as i')
      .select([
        sql<string | number | null>`avg(extract(epoch from (i.acknowledged_at - i.created_at))) filter (where i.acknowledged_at is not null)`.as('mttaSeconds'),
        sql<string | number | null>`avg(extract(epoch from (i.resolved_at - i.created_at))) filter (where i.resolved_at is not null)`.as('mttrSeconds'),
      ])
      .where('i.tenant_id', '=', tenantId)
      .where('i.deleted_at', 'is', null)
      .where('i.created_at', '>=', from)
      .where('i.created_at', '<=', to)

    if (Array.isArray(scopedOrganizationIds)) {
      query = scopedOrganizationIds.length === 1
        ? query.where('i.organization_id', '=', scopedOrganizationIds[0])
        : query.where('i.organization_id', 'in', scopedOrganizationIds)
    }

    const rows = await query.execute() as MttaMttrRow[]
    const row = rows[0] ?? { mttaSeconds: null, mttrSeconds: null }

    return NextResponse.json({
      mttaSeconds: readOptionalSeconds(row.mttaSeconds),
      mttrSeconds: readOptionalSeconds(row.mttrSeconds),
      dateRange: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('incidents.dashboard.mttaMttr failed', err)
    return NextResponse.json(
      { error: translate('incidents.dashboard.mttaMttr.error', 'Failed to load response and resolution metrics.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'MTTA and MTTR dashboard widget',
  methods: {
    GET: {
      summary: 'Fetch incident MTTA and MTTR',
      description: 'Returns average acknowledgement and resolution durations for incidents created in the last 30 days.',
      query: incidentDashboardWidgetQuerySchema,
      responses: [{ status: 200, description: 'MTTA/MTTR widget payload', schema: mttaMttrResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 403, description: 'Forbidden', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
