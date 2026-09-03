/**
 * Turning a computed report into the three deliverables of US-G4.
 *
 * Screen 14 note 3 sets the split: **PDF mirrors the sheet** the client is
 * shown — the same groups, the same rolled-up lines, the same grand total — and
 * **CSV/XLSX add the raw columns** (date, person, description) an accounts
 * department reconciles against. All three honour the current grouping, the
 * filters, the rounding and the currency, because all three are built from the
 * same `ReportSheet` the screen rendered.
 *
 * No format locks anything (screen 14 note 5). Exporting appends an `exported`
 * event and nothing else.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeExport, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { buildPdf, PDF_CONTENT_TYPE, type PdfLine } from './pdf'
import { buildXlsx, XLSX_CONTENT_TYPE } from './xlsx'
import { formatReportMinutes, type ReportGroup, type ReportLine } from './reportTotals'
import type { ReportRow } from './reportRows'
import {
  getReportExportFormat,
  registerBuiltInReportExportFormat,
  reportExportFormatIds,
  type ReportExportFormat,
} from './reportExportFormats'

const logger = createLogger('staff').child({ component: 'timesheets-reports/reportExport' })

export type { ReportExportFormat }

/**
 * EP-35: the accepted set is the registry, not a literal union, so a contributed
 * format is accepted here and documented by the route's OpenAPI enum without
 * either being edited.
 */
export function normalizeReportExportFormat(value: unknown): ReportExportFormat | null {
  if (typeof value !== 'string') return null
  return getReportExportFormat(value) ? value : null
}

export function supportedReportExportFormats(): string[] {
  return reportExportFormatIds()
}

export type ReportExportLabels = {
  documentTitle: string
  issuedBy: string
  reference: string
  period: string
  line: string
  time: string
  rate: string
  amount: string
  total: string
  totalHint: string
  nonbillable: string
  overrideBadge: string
  date: string
  project: string
  task: string
  person: string
  description: string
  billable: string
  yes: string
  no: string
  rawMinutes: string
  roundedMinutes: string
}

export type ReportExportInput = {
  reference: string
  title: string
  customerName: string
  periodLabel: string
  issuedByLabel: string | null
  issuedAtLabel: string | null
  currencyCode: string | null
  showRates: boolean
  groups: readonly ReportGroup[]
  rows: readonly ReportRow[]
  totals: { billableMinutes: number; nonbillableMinutes: number; totalAmount: number }
  roundingLabel: string
  labels: ReportExportLabels
}

export type SerializedReportExport = {
  body: Buffer
  contentType: string
  filename: string
}

function formatAmount(value: number | null | undefined, currencyCode: string | null): string {
  if (value === null || value === undefined) return '—'
  const fixed = value.toFixed(2)
  return currencyCode ? `${fixed} ${currencyCode}` : fixed
}

const COLUMN_LABEL_X = 42
const COLUMN_TIME_X = 400
const COLUMN_RATE_X = 470
const COLUMN_AMOUNT_X = 553

/** Recursion is one level deep by construction (D-2), but written generally. */
function pdfLinesForLine(
  line: ReportLine,
  depth: number,
  isNonBillable: boolean,
  showRates: boolean,
  currencyCode: string | null,
  labels: ReportExportLabels,
): PdfLine[] {
  const label = line.hasOverride ? `${line.label} (${labels.overrideBadge})` : line.label
  const cells = [
    { text: `${'    '.repeat(depth)}${label}`, x: COLUMN_LABEL_X, muted: depth > 0 },
    { text: formatReportMinutes(line.minutes), x: COLUMN_TIME_X, align: 'right' as const },
  ]
  if (showRates) {
    cells.push({
      text: isNonBillable ? '—' : formatAmount(line.rate, null),
      x: COLUMN_RATE_X,
      align: 'right' as const,
    })
  }
  cells.push({
    text: isNonBillable ? '—' : formatAmount(line.amount, null),
    x: COLUMN_AMOUNT_X,
    align: 'right' as const,
  })

  return [
    { kind: 'cells', cells },
    ...line.children.flatMap((child) =>
      pdfLinesForLine(child, depth + 1, isNonBillable, showRates, currencyCode, labels),
    ),
  ]
}

/** The PDF mirrors the on-screen sheet, group for group and line for line. */
export function buildReportPdfLines(input: ReportExportInput): PdfLine[] {
  const { labels } = input
  const lines: PdfLine[] = [
    {
      kind: 'cells',
      cells: [{ text: labels.documentTitle, x: COLUMN_LABEL_X, size: 8, muted: true }],
    },
    { kind: 'cells', cells: [{ text: input.customerName, x: COLUMN_LABEL_X, size: 15, bold: true }] },
    { kind: 'cells', cells: [{ text: input.periodLabel, x: COLUMN_LABEL_X, muted: true }] },
    {
      kind: 'cells',
      cells: [
        {
          text: `${labels.reference}: ${input.reference}`,
          x: COLUMN_AMOUNT_X,
          align: 'right',
          muted: true,
        },
      ],
    },
  ]
  if (input.issuedByLabel) {
    lines.push({
      kind: 'cells',
      cells: [
        {
          text: `${labels.issuedBy}: ${input.issuedByLabel}${input.issuedAtLabel ? ` · ${input.issuedAtLabel}` : ''}`,
          x: COLUMN_AMOUNT_X,
          align: 'right',
          muted: true,
        },
      ],
    })
  }
  lines.push({ kind: 'space', height: 10 }, { kind: 'rule' })

  for (const group of input.groups) {
    const isNonBillable = group.kind === 'nonbillable'
    lines.push({
      kind: 'cells',
      cells: [
        { text: group.label, x: COLUMN_LABEL_X, bold: true },
        { text: formatReportMinutes(group.minutes), x: COLUMN_TIME_X, align: 'right', bold: true },
        {
          text: formatAmount(isNonBillable ? 0 : group.amount, input.currencyCode),
          x: COLUMN_AMOUNT_X,
          align: 'right',
          bold: true,
        },
      ],
    })
    if (input.showRates && !isNonBillable && group.rate !== null) {
      lines.push({
        kind: 'cells',
        cells: [{ text: `${formatAmount(group.rate, input.currencyCode)}/h`, x: COLUMN_LABEL_X, muted: true, size: 8 }],
      })
    }

    const header = [
      { text: labels.line, x: COLUMN_LABEL_X, size: 8, muted: true },
      { text: labels.time, x: COLUMN_TIME_X, align: 'right' as const, size: 8, muted: true },
    ]
    if (input.showRates) {
      header.push({ text: labels.rate, x: COLUMN_RATE_X, align: 'right' as const, size: 8, muted: true })
    }
    header.push({ text: labels.amount, x: COLUMN_AMOUNT_X, align: 'right' as const, size: 8, muted: true })
    lines.push({ kind: 'cells', cells: header })

    for (const line of group.lines) {
      lines.push(
        ...pdfLinesForLine(line, 0, isNonBillable, input.showRates, input.currencyCode, labels),
      )
    }
    lines.push({ kind: 'space', height: 8 }, { kind: 'rule' })
  }

  lines.push(
    {
      kind: 'cells',
      cells: [
        { text: labels.total, x: COLUMN_LABEL_X, bold: true, size: 11 },
        {
          text: formatAmount(input.totals.totalAmount, input.currencyCode),
          x: COLUMN_AMOUNT_X,
          align: 'right',
          bold: true,
          size: 11,
        },
      ],
    },
    {
      kind: 'cells',
      cells: [
        {
          text: labels.totalHint
            .replace('{billable}', formatReportMinutes(input.totals.billableMinutes))
            .replace('{nonbillable}', formatReportMinutes(input.totals.nonbillableMinutes))
            .replace('{rounding}', input.roundingLabel),
          x: COLUMN_LABEL_X,
          size: 8,
          muted: true,
        },
      ],
    },
  )

  return lines
}

/**
 * The raw table. `rawMinutes` sits beside `roundedMinutes` on purpose: the
 * difference between them IS the rounding, and an accountant asking why an
 * amount is what it is should be able to see it rather than derive it.
 */
export function buildReportTable(input: ReportExportInput): PreparedExport {
  const { labels } = input
  const columns = [
    { field: 'date', header: labels.date },
    { field: 'project', header: labels.project },
    { field: 'task', header: labels.task },
    { field: 'person', header: labels.person },
    { field: 'description', header: labels.description },
    { field: 'rawMinutes', header: labels.rawMinutes },
    { field: 'roundedMinutes', header: labels.roundedMinutes },
    { field: 'hours', header: labels.time },
    { field: 'billable', header: labels.billable },
    ...(input.showRates ? [{ field: 'rate', header: labels.rate }] : []),
    { field: 'amount', header: labels.amount },
  ]

  const rows = input.rows.map((row) => {
    const record: Record<string, unknown> = {
      date: row.date,
      project: row.projectName,
      task: row.taskLabel,
      person: row.personLabel,
      description: row.description,
      rawMinutes: row.rawMinutes,
      roundedMinutes: row.minutes,
      hours: row.hours,
      billable: row.isBillable ? labels.yes : labels.no,
      amount: row.amount === null ? '' : row.amount.toFixed(2),
    }
    if (input.showRates) record.rate = row.rate === null ? '' : row.rate.toFixed(2)
    return record
  })

  return { columns, rows }
}

function exportBaseName(input: ReportExportInput): string {
  return input.reference || 'report'
}

registerBuiltInReportExportFormat({
  id: 'pdf',
  labelKey: 'staff.time_tracking.reports.export.format.pdf',
  mimeType: PDF_CONTENT_TYPE,
  extension: 'pdf',
  serialize: (input) => ({
    body: buildPdf({ title: input.title, lines: buildReportPdfLines(input) }),
    contentType: PDF_CONTENT_TYPE,
    filename: `${exportBaseName(input)}.pdf`,
  }),
})

registerBuiltInReportExportFormat({
  id: 'csv',
  labelKey: 'staff.time_tracking.reports.export.format.csv',
  mimeType: 'text/csv',
  extension: 'csv',
  serialize: (input) => {
    const serialized = serializeExport(buildReportTable(input), 'csv')
    return {
      // The BOM is what makes Excel open a UTF-8 CSV with Polish names intact
      // instead of mojibake; every other consumer ignores it.
      body: Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(serialized.body, 'utf8')]),
      contentType: serialized.contentType,
      filename: `${exportBaseName(input)}.csv`,
    }
  },
})

registerBuiltInReportExportFormat({
  id: 'xlsx',
  labelKey: 'staff.time_tracking.reports.export.format.xlsx',
  mimeType: XLSX_CONTENT_TYPE,
  extension: 'xlsx',
  serialize: (input) => {
    const table = buildReportTable(input)
    const rows = [
      table.columns.map((column) => column.header),
      ...table.rows.map((row) =>
        table.columns.map((column) => {
          const value = row[column.field]
          if (column.field === 'rate' || column.field === 'amount') {
            const parsed = typeof value === 'string' && value.length > 0 ? Number.parseFloat(value) : null
            return parsed !== null && Number.isFinite(parsed) ? parsed : ''
          }
          return typeof value === 'number' ? value : value === null || value === undefined ? '' : String(value)
        }),
      ),
    ]
    return {
      body: buildXlsx({ name: exportBaseName(input).slice(0, 31), rows }),
      contentType: XLSX_CONTENT_TYPE,
      filename: `${exportBaseName(input)}.xlsx`,
    }
  },
})

/**
 * A contributed `serialize` is the one strategy whose failure cannot be absorbed:
 * the caller asked for a named format and every fallback would answer with bytes of
 * a different type under the requested filename and MIME. So the throw propagates —
 * but it is caught and re-raised as an internal error naming the format, so the one
 * request fails with something diagnosable instead of a stack trace from a third
 * party's serializer.
 */
export function serializeReportExport(
  format: ReportExportFormat,
  input: ReportExportInput,
): SerializedReportExport {
  const definition = getReportExportFormat(format)
  if (!definition) {
    throw new Error(`[internal] unknown report export format: ${String(format)}`)
  }
  try {
    return definition.serialize(input)
  } catch (err) {
    logger.error('a report export format failed to serialize', { format: definition.id, err })
    throw new Error(`[internal] report export format ${definition.id} failed to serialize`)
  }
}
