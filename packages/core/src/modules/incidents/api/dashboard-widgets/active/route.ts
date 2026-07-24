import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  getIncidentDashboardDb,
  incidentDashboardWidgetQuerySchema,
  LIVE_INCIDENT_EXCLUDED_STATUSES,
  readCount,
  resolveIncidentDashboardWidgetContext,
  uniqueOrganizationIds,
} from '../utils'

type ActiveSeverityRow = {
  severityId: string | null
  severityKey: string | null
  severityLabel: string | null
  count: string | number
}

const activeBreakdownItemSchema = z.object({
  severityId: z.string().uuid().nullable(),
  severityKey: z.string().nullable(),
  label: z.string(),
  count: z.number(),
})

const activeResponseSchema = z.object({
  total: z.number(),
  breakdown: z.array(activeBreakdownItemSchema),
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

    let query = db
      .selectFrom('incidents as i')
      .leftJoin('incident_severities as s', (join) =>
        join
          .onRef('s.id', '=', 'i.severity_id')
          .onRef('s.organization_id', '=', 'i.organization_id')
          .onRef('s.tenant_id', '=', 'i.tenant_id')
          .on('s.deleted_at', 'is', null)
      )
      .select([
        'i.severity_id as severityId',
        's.key as severityKey',
        's.label as severityLabel',
        sql<string | number>`count(*)`.as('count'),
      ])
      .where('i.tenant_id', '=', tenantId)
      .where('i.deleted_at', 'is', null)
      .where('i.status', 'not in', [...LIVE_INCIDENT_EXCLUDED_STATUSES])

    if (Array.isArray(scopedOrganizationIds)) {
      query = scopedOrganizationIds.length === 1
        ? query.where('i.organization_id', '=', scopedOrganizationIds[0])
        : query.where('i.organization_id', 'in', scopedOrganizationIds)
    }

    const rows = await query
      .groupBy(['i.severity_id', 's.key', 's.label', 's.rank'])
      .orderBy('s.rank', 'asc')
      .execute() as ActiveSeverityRow[]

    const breakdown = rows.map((row) => {
      const label = typeof row.severityLabel === 'string' && row.severityLabel.trim().length > 0
        ? row.severityLabel
        : row.severityKey ?? row.severityId ?? 'unknown'
      return {
        severityId: row.severityId,
        severityKey: row.severityKey,
        label,
        count: readCount(row.count),
      }
    })

    return NextResponse.json({
      total: breakdown.reduce((sum, item) => sum + item.count, 0),
      breakdown,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('incidents.dashboard.active failed', err)
    return NextResponse.json(
      { error: translate('incidents.dashboard.active.error', 'Failed to load active incidents.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Active incidents dashboard widget',
  methods: {
    GET: {
      summary: 'Fetch active incident count',
      description: 'Returns the live incident count and severity breakdown for the authenticated dashboard scope.',
      query: incidentDashboardWidgetQuerySchema,
      responses: [{ status: 200, description: 'Active incident KPI payload', schema: activeResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 403, description: 'Forbidden', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
