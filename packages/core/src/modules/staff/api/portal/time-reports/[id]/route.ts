/**
 * `GET /api/staff/portal/time-reports/{id}` — EP-50.
 *
 * The ownership check is the list route's, unchanged and re-applied here rather
 * than inherited from it: the id in the path is caller-supplied, so the row it
 * names is loaded WITH `tenant_id`, `organization_id`, `customer_id`,
 * `status = 'closed'` and `deleted_at IS NULL` in the same WHERE clause, never
 * loaded first and checked after. A report belonging to another customer of the
 * same organization is a `404`, not a `403` — the portal must not confirm that
 * somebody else's report exists.
 *
 * The per-project breakdown reads the FROZEN minutes on `staff_time_report_entries`,
 * which is what the close wrote and what the client was told. It carries no
 * `frozen_rate_amount` and no `frozen_amount`; see the list route's header for why
 * money is structurally absent from this surface rather than conditionally hidden.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { portalOwnedReportClause } from '../../../../lib/time-tracking/portalReports'
import { resolvePortalScope, toIsoDate, toMinutes } from '../route'

const logger = createLogger('staff').child({ component: 'api/portal/time-reports/[id]' })

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

const paramsSchema = z.object({ id: z.string().uuid() })

const errorResponseSchema = z.object({ ok: z.literal(false), error: z.string() })

const projectLineSchema = z.object({
  timeProjectId: z.string().nullable(),
  projectName: z.string().nullable(),
  billableMinutes: z.number().int(),
  nonbillableMinutes: z.number().int(),
})

const detailResponseSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  title: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  closedAt: z.string().nullable(),
  totalBillableMinutes: z.number().int(),
  totalNonbillableMinutes: z.number().int(),
  projects: z.array(projectLineSchema),
})

type ReportRow = {
  id: string
  reference: string
  title: string
  period_from: Date | string
  period_to: Date | string
  closed_at: Date | string | null
  total_billable_minutes: number | string | null
  total_nonbillable_minutes: number | string | null
}

type ProjectRow = {
  time_project_id: string | null
  project_name: string | null
  billable_minutes: number | string | null
  nonbillable_minutes: number | string | null
}

function readReportId(req: Request): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  const parsed = paramsSchema.safeParse({ id: last })
  return parsed.success ? parsed.data.id : null
}

export async function GET(req: Request) {
  try {
    const scopeOrResponse = await resolvePortalScope(req)
    if (scopeOrResponse instanceof Response) return scopeOrResponse
    const scope = scopeOrResponse

    const reportId = readReportId(req)
    if (!reportId) {
      return NextResponse.json({ ok: false, error: 'staff.errors.invalidInput' }, { status: 400 })
    }

    const connection = scope.em.getConnection()
    const owned = portalOwnedReportClause(scope)
    const rows = (await connection.execute(
      `
        SELECT id, reference, title, period_from, period_to, closed_at,
               total_billable_minutes, total_nonbillable_minutes
        FROM staff_time_reports
        WHERE ${owned.sql} AND id = ?
        LIMIT 1
      `,
      [...owned.params, reportId],
    )) as ReportRow[]

    const report = rows?.[0]
    if (!report) {
      return NextResponse.json({ ok: false, error: 'staff.errors.notFound' }, { status: 404 })
    }

    const periodFrom = toIsoDate(report.period_from)
    const periodTo = toIsoDate(report.period_to)
    if (!periodFrom || !periodTo) {
      return NextResponse.json({ ok: false, error: 'staff.errors.notFound' }, { status: 404 })
    }

    const projectRows = (await connection.execute(
      `
        SELECT entry.time_project_id AS time_project_id,
               project.name AS project_name,
               COALESCE(SUM(CASE WHEN line.frozen_is_billable THEN line.frozen_rounded_minutes ELSE 0 END), 0) AS billable_minutes,
               COALESCE(SUM(CASE WHEN line.frozen_is_billable THEN 0 ELSE line.frozen_rounded_minutes END), 0) AS nonbillable_minutes
        FROM staff_time_report_entries line
        JOIN staff_time_entries entry
          ON entry.id = line.time_entry_id
         AND entry.tenant_id = line.tenant_id
         AND entry.organization_id = line.organization_id
        LEFT JOIN staff_time_projects project
          ON project.id = entry.time_project_id
         AND project.tenant_id = line.tenant_id
         AND project.organization_id = line.organization_id
        WHERE line.report_id = ?
          AND line.tenant_id = ?
          AND line.organization_id = ?
        GROUP BY entry.time_project_id, project.name
        ORDER BY project.name ASC NULLS LAST
      `,
      [report.id, scope.tenantId, scope.organizationId],
    )) as ProjectRow[]

    return NextResponse.json(
      detailResponseSchema.parse({
        id: report.id,
        reference: report.reference,
        title: report.title,
        periodFrom,
        periodTo,
        closedAt:
          report.closed_at instanceof Date
            ? report.closed_at.toISOString()
            : typeof report.closed_at === 'string' && report.closed_at.trim().length > 0
              ? report.closed_at
              : null,
        totalBillableMinutes: toMinutes(report.total_billable_minutes),
        totalNonbillableMinutes: toMinutes(report.total_nonbillable_minutes),
        projects: projectRows.map((row) => ({
          timeProjectId: row.time_project_id ?? null,
          projectName: row.project_name ?? null,
          billableMinutes: toMinutes(row.billable_minutes),
          nonbillableMinutes: toMinutes(row.nonbillable_minutes),
        })),
      }),
    )
  } catch (err) {
    logger.error('staff portal time-report detail failed', { err })
    return NextResponse.json({ ok: false, error: 'staff.errors.internal' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Read one closed time report belonging to the signed-in customer',
      description:
        'Loads the report by id **together with** the tenant, organization, customer and closed-status predicates, so a report belonging to another customer of the same organization answers 404. Returns the frozen minute totals per project; no rate, cost, amount or currency is present in the response.',
      pathParams: paramsSchema,
      responses: [{ status: 200, description: 'The report', schema: detailResponseSchema }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: errorResponseSchema },
        { status: 403, description: 'The portal account is not linked to a customer', schema: errorResponseSchema },
        { status: 404, description: 'No closed report with that id belongs to this customer', schema: errorResponseSchema },
      ],
    },
  },
}
