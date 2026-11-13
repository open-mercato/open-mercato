/**
 * Client-side parsing for `GET .../reports/[id]/sheet`.
 *
 * Defensive for the same reason `reportConfigData` is: these numbers are printed
 * on a document a client can dispute, so a shape surprise must yield a visibly
 * empty sheet rather than a plausible wrong figure.
 */

import { parseReportPreview, readNumber, type PreviewGroup } from './reportConfigData'

export type ReportEventType = 'closed' | 'unlocked' | 'exported'

export type ReportHistoryEvent = {
  id: string
  eventType: ReportEventType
  reason: string | null
  actorUserId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string | null
}

export type ReportSheetRow = {
  entryId: string
  date: string
  projectName: string
  taskLabel: string
  personLabel: string
  description: string
  minutes: number
  rawMinutes: number
  hours: string
  isBillable: boolean
  rate: number | null
  amount: number | null
  hasOverride: boolean
}

export type ReportSheetHeader = {
  id: string
  reference: string
  title: string
  status: 'draft' | 'closed'
  customerId: string | null
  customerName: string | null
  periodFrom: string | null
  periodTo: string | null
  currencyCode: string | null
  grouping: 'project_task' | 'project_person' | 'project_day'
  nonbillableMode: 'separate' | 'exclude'
  includeAlreadyReported: boolean
  showRates: boolean
  roundingUnitMinutes: number
  roundingDirection: string
  closedAt: string | null
  closedByUserId: string | null
  timeProjectIds: string[]
}

export type ReportSheetPayload = {
  report: ReportSheetHeader
  groups: PreviewGroup[]
  totals: {
    entryCount: number
    billableMinutes: number
    nonbillableMinutes: number
    totalAmount: number | null
  }
  alreadyReportedCount: number
  alreadyReportedMinutes: number
  rows: ReportSheetRow[]
  rowCount: number
  rowsTruncated: boolean
  events: ReportHistoryEvent[]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** D-9: the customer name comes from the report's own snapshot, never a join. */
export function readCustomerName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const row = snapshot as Record<string, unknown>
  for (const key of ['name', 'displayName', 'display_name', 'legalName', 'legal_name']) {
    const value = readString(row[key])
    if (value) return value
  }
  return null
}

export function parseReportSheet(payload: unknown): ReportSheetPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const reportRaw = row.report
  if (!reportRaw || typeof reportRaw !== 'object') return null
  const report = reportRaw as Record<string, unknown>
  const id = readString(report.id)
  if (!id) return null

  // The grouped sheet has exactly the preview's shape, so it goes through the
  // same parser — one place decides what a malformed group means.
  const preview = parseReportPreview({
    currencyCode: report.currencyCode,
    grouping: report.grouping,
    nonbillableMode: report.nonbillableMode,
    includeAlreadyReported: report.includeAlreadyReported,
    showRates: report.showRates,
    projects: [],
    groups: row.groups,
    totals: row.totals,
    alreadyReportedCount: row.alreadyReportedCount,
    alreadyReportedMinutes: row.alreadyReportedMinutes,
    alreadyReportedIn: row.alreadyReportedIn,
    rounding: { unitMinutes: report.roundingUnitMinutes, direction: report.roundingDirection },
  })
  if (!preview) return null

  return {
    report: {
      id,
      reference: readString(report.reference) ?? '',
      title: readString(report.title) ?? '',
      status: report.status === 'closed' ? 'closed' : 'draft',
      customerId: readString(report.customerId),
      customerName: readCustomerName(report.customerSnapshot),
      periodFrom: readString(report.periodFrom),
      periodTo: readString(report.periodTo),
      currencyCode: preview.currencyCode,
      grouping: preview.grouping,
      nonbillableMode: preview.nonbillableMode,
      includeAlreadyReported: preview.includeAlreadyReported,
      showRates: preview.showRates,
      roundingUnitMinutes: preview.rounding.unitMinutes,
      roundingDirection: preview.rounding.direction,
      closedAt: readString(report.closedAt),
      closedByUserId: readString(report.closedByUserId),
      timeProjectIds: Array.isArray(report.timeProjectIds)
        ? report.timeProjectIds.filter((value): value is string => typeof value === 'string')
        : [],
    },
    groups: preview.groups,
    totals: preview.totals,
    alreadyReportedCount: preview.alreadyReportedCount,
    alreadyReportedMinutes: preview.alreadyReportedMinutes,
    rows: Array.isArray(row.rows)
      ? row.rows
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const source = entry as Record<string, unknown>
            const entryId = readString(source.entryId)
            if (!entryId) return null
            return {
              entryId,
              date: readString(source.date) ?? '',
              projectName: readString(source.projectName) ?? '',
              taskLabel: readString(source.taskLabel) ?? '',
              personLabel: readString(source.personLabel) ?? '',
              description: readString(source.description) ?? '',
              minutes: readNumber(source.minutes) ?? 0,
              rawMinutes: readNumber(source.rawMinutes) ?? 0,
              hours: readString(source.hours) ?? '',
              isBillable: source.isBillable !== false,
              rate: readNumber(source.rate),
              amount: readNumber(source.amount),
              hasOverride: source.hasOverride === true,
            } satisfies ReportSheetRow
          })
          .filter((entry): entry is ReportSheetRow => entry !== null)
      : [],
    rowCount: readNumber(row.rowCount) ?? 0,
    rowsTruncated: row.rowsTruncated === true,
    events: Array.isArray(row.events)
      ? row.events
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const source = entry as Record<string, unknown>
            const eventId = readString(source.id)
            const eventType = source.eventType
            if (!eventId) return null
            if (eventType !== 'closed' && eventType !== 'unlocked' && eventType !== 'exported') return null
            return {
              id: eventId,
              eventType,
              reason: readString(source.reason),
              actorUserId: readString(source.actorUserId),
              metadata:
                source.metadata && typeof source.metadata === 'object'
                  ? (source.metadata as Record<string, unknown>)
                  : null,
              createdAt: readString(source.createdAt),
            } satisfies ReportHistoryEvent
          })
          .filter((entry): entry is ReportHistoryEvent => entry !== null)
      : [],
  }
}
