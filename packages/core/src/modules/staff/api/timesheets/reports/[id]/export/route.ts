/**
 * `GET /api/staff/timesheets/reports/[id]/export?format=pdf|csv|xlsx` — US-G4.
 *
 * Two rules from screen 14:
 *
 *  - **Note 3.** The export inherits the current grouping, filters, rounding and
 *    currency, because it is produced from the same `buildReportSheet` the page
 *    rendered. PDF mirrors that sheet; CSV and XLSX add the raw accounting
 *    columns (date, person, description, raw vs rounded minutes).
 *  - **Note 5.** Exporting NEVER locks. The only write here is an append-only
 *    `exported` report event, which is what lets the unlock dialog say "the PDF
 *    was downloaded on the 20th" before someone restates a billed hour.
 *
 * The event is appended after the file is built, so a failed render leaves no
 * trace of an export that never happened; a failed event write is logged and
 * does not deny the caller their file.
 */

import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStaffEvent } from '../../../../../events'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeReport, StaffTimeReportEvent } from '../../../../../data/entities'
import { loadReportProjectIds } from '../../../../../commands/timesheets-reports'
import { buildReportSheet } from '../../../../../lib/timesheets-reports/buildReportSheet'
import { buildReportRows } from '../../../../../lib/timesheets-reports/reportRows'
import {
  normalizeReportExportFormat,
  serializeReportExport,
  type ReportExportLabels,
} from '../../../../../lib/timesheets-reports/reportExport'
import type { ReportGrouping } from '../../../../../lib/timesheets-reports/reportTotals'
import { resolveReportRequestContext, reportSheetLabels, type Translate } from '../../shared'

const logger = createLogger('staff').child({ component: 'api/timesheets/reports/export' })


export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.reports.view'] },
}

function readQuery(url: string | undefined): { format: string | null; grouping: ReportGrouping | undefined } {
  if (!url) return { format: null, grouping: undefined }
  try {
    const params = new URL(url).searchParams
    const grouping = params.get('grouping')
    return {
      format: params.get('format'),
      grouping:
        grouping === 'project_task' || grouping === 'project_person' || grouping === 'project_day'
          ? grouping
          : undefined,
    }
  } catch {
    return { format: null, grouping: undefined }
  }
}

function exportLabels(translate: Translate): ReportExportLabels {
  return {
    documentTitle: translate('staff.time_tracking.reports.sheet.overline', 'Time and cost statement'),
    issuedBy: translate('staff.time_tracking.reports.sheet.issuedBy', 'Issued by'),
    reference: translate('staff.time_tracking.reports.sheet.reference', 'Reference'),
    period: translate('staff.time_tracking.reports.sheet.period', 'Period'),
    line: translate('staff.time_tracking.reports.sheet.lineLabel', 'Line'),
    time: translate('staff.time_tracking.reports.sheet.time', 'Time'),
    rate: translate('staff.time_tracking.reports.sheet.rate', 'Rate'),
    amount: translate('staff.time_tracking.reports.sheet.amount', 'Amount'),
    total: translate('staff.time_tracking.reports.sheet.total', 'Total to invoice'),
    totalHint: translate(
      'staff.time_tracking.reports.sheet.totalHint',
      '{billable} billable · {nonbillable} non-billable · {rounding}',
    ),
    nonbillable: translate('staff.time_tracking.reports.sheet.nonbillable', 'Non-billable time'),
    overrideBadge: translate('staff.time_tracking.reports.sheet.overrideBadge', 'agreed rate'),
    date: translate('staff.time_tracking.reports.export.date', 'Date'),
    project: translate('staff.time_tracking.reports.export.project', 'Project'),
    task: translate('staff.time_tracking.reports.export.task', 'Task'),
    person: translate('staff.time_tracking.reports.export.person', 'Person'),
    description: translate('staff.time_tracking.reports.export.description', 'Description'),
    billable: translate('staff.time_tracking.reports.export.billable', 'Billable'),
    yes: translate('staff.time_tracking.reports.export.yes', 'Yes'),
    no: translate('staff.time_tracking.reports.export.no', 'No'),
    rawMinutes: translate('staff.time_tracking.reports.export.rawMinutes', 'Raw minutes'),
    roundedMinutes: translate('staff.time_tracking.reports.export.roundedMinutes', 'Rounded minutes'),
  }
}

function roundingLabel(translate: Translate, unitMinutes: number, direction: string): string {
  if (!unitMinutes) return translate('staff.time_tracking.reports.rounding.off', 'no rounding')
  const directionLabel =
    direction === 'nearest'
      ? translate('staff.time_tracking.reports.rounding.nearest', 'to the nearest')
      : translate('staff.time_tracking.reports.rounding.up', 'always up')
  return translate('staff.time_tracking.reports.rounding.rule', 'rounding {minutes} min, {direction}')
    .replace('{minutes}', String(unitMinutes))
    .replace('{direction}', directionLabel)
}

function readCustomerName(snapshot: Record<string, unknown> | null | undefined, fallback: string): string {
  if (!snapshot) return fallback
  for (const key of ['name', 'displayName', 'display_name', 'legalName', 'legal_name']) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return fallback
}

export async function GET(req: Request) {
  try {
    const context = await resolveReportRequestContext(req, { segment: 'export' })
    // `canSeeMoney` comes from the shared context and is never re-derived here:
    // the previous `grantedFeatures === null || authorize(...)` opened the money
    // fields whenever the grant read failed, and this route requires only
    // `reports.view`, so nothing else stood in the way.
    const { container, auth, tenantId, organizationId, reportId, translate, canSeeMoney } = context

    const { format: rawFormat, grouping } = readQuery(req.url)
    const format = normalizeReportExportFormat(rawFormat)
    if (!format) {
      throw new CrudHttpError(400, {
        error: translate(
          'staff.time_tracking.reports.errors.unsupportedFormat',
          'Supported export formats are pdf, csv and xlsx.',
        ),
      })
    }

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
      grouping,
    })
    const rows = buildReportRows({
      entries: sheet.entries,
      projects: sheet.projects,
      directory: sheet.directory,
      labels,
    })

    const periodFrom = report.periodFrom instanceof Date ? report.periodFrom.toISOString().slice(0, 10) : ''
    const periodTo = report.periodTo instanceof Date ? report.periodTo.toISOString().slice(0, 10) : ''

    const file = serializeReportExport(format, {
      reference: report.reference,
      title: report.title,
      customerName: readCustomerName(report.customerSnapshot, report.title),
      periodLabel: `${periodFrom} – ${periodTo}`,
      issuedByLabel: null,
      issuedAtLabel: report.closedAt ? report.closedAt.toISOString().slice(0, 10) : null,
      currencyCode: sheet.currencyCode,
      showRates: (report.showRates ?? true) && canSeeMoney,
      groups: sheet.totals.groups,
      rows: canSeeMoney ? rows : rows.map((row) => ({ ...row, rate: null, amount: null })),
      totals: {
        billableMinutes: sheet.totals.billableMinutes,
        nonbillableMinutes: sheet.totals.nonbillableMinutes,
        totalAmount: canSeeMoney ? sheet.totals.totalAmount : 0,
      },
      roundingLabel: roundingLabel(
        translate,
        report.roundingUnitMinutes ?? 0,
        report.roundingDirection ?? 'up',
      ),
      labels: exportLabels(translate),
    })

    // Append-only audit. Never a lock — screen 14 note 5.
    try {
      const eventEm = (container.resolve('em') as EntityManager).fork()
      eventEm.persist(
        eventEm.create(StaffTimeReportEvent, {
          tenantId,
          organizationId,
          reportId: report.id,
          eventType: 'exported',
          reason: null,
          actorUserId: typeof auth.sub === 'string' ? auth.sub : null,
          metadata: { format, grouping: sheet.grouping, rowCount: rows.length },
          createdAt: new Date(),
        }),
      )
      await eventEm.flush()
    } catch (err) {
      // The caller already has a correct file; refusing it because the audit row
      // failed would be the wrong trade.
      logger.error('staff.timesheets.reports.export audit event failed', { err })
    }

    void emitStaffEvent('staff.timesheets.time_report.exported', {
      id: report.id,
      tenantId,
      organizationId,
      reference: report.reference,
      format,
      grouping: sheet.grouping,
      rowCount: rows.length,
    }, { persistent: true }).catch((err) => {
      logger.error('staff.timesheets emit time_report.exported failed', { err })
    })

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.timesheets.reports.export failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Export a customer report',
  methods: {
    GET: {
      summary: 'Export a customer report',
      description:
        'Renders the report as `pdf` (mirrors the on-screen sheet, client-facing), `csv` or `xlsx` (raw accounting columns: date, project, task, person, description, raw and rounded minutes, billable, rate, amount). Honours the report grouping — overridable per request with `?grouping=` — plus its filters, rounding and currency. Appends an `exported` report event; exporting never locks entries. Rates and amounts are omitted for a caller without staff.timesheets.rates.view.',
      responses: [{ status: 200, description: 'The rendered report file' }],
      errors: [
        { status: 400, description: 'Unsupported format' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.reports.view' },
        { status: 404, description: 'Report not found or not accessible' },
      ],
    },
  },
}
