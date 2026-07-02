import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  compareMinorAmountDesc,
  getIncidentDashboardDb,
  incidentDashboardWidgetQuerySchema,
  LIVE_INCIDENT_EXCLUDED_STATUSES,
  readMinorAmount,
  resolveIncidentDashboardWidgetContext,
  uniqueOrganizationIds,
} from '../utils'

type RevenueRow = {
  currency: string | null
  amountMinor: string | number | bigint | null
}

const currencyTotalSchema = z.object({
  currency: z.string().nullable(),
  amountMinor: z.string(),
})

const revenueAtRiskResponseSchema = z.object({
  dominant: currencyTotalSchema,
  currencies: z.array(currencyTotalSchema),
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
      .select([
        'i.revenue_at_risk_currency as currency',
        sql<string | number | bigint | null>`coalesce(sum(i.revenue_at_risk_minor), 0)`.as('amountMinor'),
      ])
      .where('i.tenant_id', '=', tenantId)
      .where('i.deleted_at', 'is', null)
      .where('i.status', 'not in', [...LIVE_INCIDENT_EXCLUDED_STATUSES])
      .where('i.revenue_at_risk_minor', 'is not', null)

    if (Array.isArray(scopedOrganizationIds)) {
      query = scopedOrganizationIds.length === 1
        ? query.where('i.organization_id', '=', scopedOrganizationIds[0])
        : query.where('i.organization_id', 'in', scopedOrganizationIds)
    }

    const rows = await query
      .groupBy('i.revenue_at_risk_currency')
      .execute() as RevenueRow[]

    const currencies = rows
      .map((row) => ({
        currency: typeof row.currency === 'string' && row.currency.trim().length > 0 ? row.currency.trim().toUpperCase() : null,
        amountMinor: readMinorAmount(row.amountMinor),
      }))
      .sort((left, right) => compareMinorAmountDesc(left.amountMinor, right.amountMinor))

    const dominant = currencies[0] ?? { currency: null, amountMinor: '0' }

    return NextResponse.json({
      dominant,
      currencies,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('incidents.dashboard.revenueAtRisk failed', err)
    return NextResponse.json(
      { error: translate('incidents.dashboard.revenueAtRisk.error', 'Failed to load revenue at risk.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Revenue at risk dashboard widget',
  methods: {
    GET: {
      summary: 'Fetch incident revenue at risk',
      description: 'Returns revenue-at-risk totals grouped by currency for live incidents in the authenticated dashboard scope.',
      query: incidentDashboardWidgetQuerySchema,
      responses: [{ status: 200, description: 'Revenue-at-risk KPI payload', schema: revenueAtRiskResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 403, description: 'Forbidden', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
