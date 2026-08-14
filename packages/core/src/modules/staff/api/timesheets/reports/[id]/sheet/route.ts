/**
 * `GET /api/staff/timesheets/reports/[id]/sheet` — everything screens 14 and 15
 * render: the report header, the grouped sheet, the raw entry rows and the
 * close/unlock/export history.
 *
 * It is a separate route from the CRUD detail because the sheet is COMPUTED. A
 * draft is computed live (and therefore moves when an entry is edited); a closed
 * report is rebuilt from its own freeze records, so a later rounding change
 * cannot restate an invoice the client already has (risk R1). One endpoint
 * answering both keeps the page from having to know which case it is in.
 *
 * `?grouping=` re-groups the same numbers without persisting the choice, which
 * is what lets screen 14 flip between task / person / day and still print the
 * same grand total (D-7).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeReport, StaffTimeReportEvent } from '../../../../../data/entities'
import { loadReportProjectIds } from '../../../../../commands/timesheets-reports'
import { buildReportSheet } from '../../../../../lib/timesheets-reports/buildReportSheet'
import { buildReportRows } from '../../../../../lib/timesheets-reports/reportRows'
import type { ReportGrouping } from '../../../../../lib/timesheets-reports/reportTotals'
import { resolveReportRequestContext, reportSheetLabels, MAX_SHEET_ROWS } from '../../shared'

const logger = createLogger('staff').child({ component: 'api/timesheets/reports/sheet' })

const RATES_FEATURE = 'staff.timesheets.rates.view'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.reports.view'] },
}

function readGrouping(url: string | undefined): ReportGrouping | undefined {
  if (!url) return undefined
  try {
    const value = new URL(url).searchParams.get('grouping')
    if (value === 'project_task' || value === 'project_person' || value === 'project_day') return value
  } catch {
    return undefined
  }
  return undefined
}

export async function GET(req: Request) {
  try {
    const context = await resolveReportRequestContext(req, { segment: 'sheet' })
    const { container, tenantId, organizationId, reportId, translate, grantedFeatures } = context
    const canSeeMoney = grantedFeatures === null || authorizeFeatures([RATES_FEATURE], { grantedFeatures })

    const em = (container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(StaffTimeReport, {
      id: reportId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!report) {
      throw new CrudHttpError(404, {
        error: translate('staff.time_tracking.reports.errors.notFound', 'Report not found or not accessible.'),
      })
    }

    const timeProjectIds = await loadReportProjectIds(em, report.id, { tenantId, organizationId })
    const labels = reportSheetLabels(translate)
    const sheet = await buildReportSheet({
      em,
      scope: { tenantId, organizationId },
      report,
      timeProjectIds,
      labels,
      grouping: readGrouping(req.url),
    })

    const rows = buildReportRows({
      entries: sheet.entries,
      projects: sheet.projects,
      directory: sheet.directory,
      labels,
    })

    const events = await em.find(
      StaffTimeReportEvent,
      { reportId: report.id, tenantId, organizationId },
      { orderBy: { createdAt: 'desc' } },
    )

    return NextResponse.json({
      report: {
        id: report.id,
        reference: report.reference,
        title: report.title,
        status: report.status,
        customerId: report.customerId,
        customerSnapshot: report.customerSnapshot ?? null,
        periodKind: report.periodKind,
        periodFrom: report.periodFrom instanceof Date ? report.periodFrom.toISOString().slice(0, 10) : null,
        periodTo: report.periodTo instanceof Date ? report.periodTo.toISOString().slice(0, 10) : null,
        currencyCode: sheet.currencyCode,
        grouping: sheet.grouping,
        nonbillableMode: sheet.nonbillableMode,
        includeAlreadyReported: report.includeAlreadyReported ?? false,
        showRates: (report.showRates ?? true) && canSeeMoney,
        roundingUnitMinutes: report.roundingUnitMinutes ?? 0,
        roundingDirection: report.roundingDirection ?? 'up',
        closedAt: report.closedAt ? report.closedAt.toISOString() : null,
        closedByUserId: report.closedByUserId ?? null,
        createdByUserId: report.createdByUserId ?? null,
        createdAt: report.createdAt ? report.createdAt.toISOString() : null,
        updatedAt: report.updatedAt ? report.updatedAt.toISOString() : null,
        timeProjectIds,
      },
      groups: canSeeMoney ? sheet.totals.groups : stripAmounts(sheet.totals.groups),
      totals: {
        entryCount: sheet.totals.entryCount,
        billableMinutes: sheet.totals.billableMinutes,
        nonbillableMinutes: sheet.totals.nonbillableMinutes,
        totalAmount: canSeeMoney ? sheet.totals.totalAmount : null,
      },
      alreadyReportedCount: sheet.totals.alreadyReportedCount,
      alreadyReportedMinutes: sheet.totals.alreadyReportedMinutes,
      alreadyReportedIn: sheet.totals.alreadyReportedIn,
      rows: rows.slice(0, MAX_SHEET_ROWS).map((row) => ({
        ...row,
        rate: canSeeMoney ? row.rate : null,
        amount: canSeeMoney ? row.amount : null,
      })),
      rowCount: rows.length,
      rowsTruncated: rows.length > MAX_SHEET_ROWS,
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        reason: event.reason ?? null,
        actorUserId: event.actorUserId ?? null,
        metadata: event.metadata ?? null,
        createdAt: event.createdAt ? event.createdAt.toISOString() : null,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.timesheets.reports.sheet failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

type SheetGroups = Awaited<ReturnType<typeof buildReportSheet>>['totals']['groups']

/** Money is absent, not zeroed, for a caller without `rates.view`. */
function stripAmounts(groups: SheetGroups): SheetGroups {
  return groups.map((group) => ({
    ...group,
    rate: null,
    amount: 0,
    lines: group.lines.map(function strip(line): SheetGroups[number]['lines'][number] {
      return { ...line, rate: null, amount: 0, children: line.children.map(strip) }
    }),
  }))
}

const sheetResponseSchema = z.object({
  report: z.object({
    id: z.string().uuid(),
    reference: z.string(),
    title: z.string(),
    status: z.enum(['draft', 'closed']),
    currencyCode: z.string().nullable(),
    periodFrom: z.string().nullable(),
    periodTo: z.string().nullable(),
    showRates: z.boolean(),
  }),
  totals: z.object({
    entryCount: z.number().int(),
    billableMinutes: z.number().int(),
    nonbillableMinutes: z.number().int(),
    totalAmount: z.number().nullable(),
  }),
  rowCount: z.number().int(),
  rowsTruncated: z.boolean(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Read a customer report sheet',
  methods: {
    GET: {
      summary: 'Read a customer report sheet',
      description:
        'Returns the report header, the grouped sheet, the raw entry rows and the close/unlock/export history. A draft is computed live; a closed report is rebuilt from its own frozen snapshots so a later rounding or rate change cannot restate it. `?grouping=project_task|project_person|project_day` re-groups the same numbers without persisting the choice — the grand total is invariant under it (D-7). Amounts are omitted for a caller without staff.timesheets.rates.view.',
      responses: [{ status: 200, description: 'Report sheet', schema: sheetResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.reports.view' },
        { status: 404, description: 'Report not found or not accessible' },
      ],
    },
  },
}
