/**
 * The sheet of screen 14, built once and reused by the detail page, the exports
 * and the close command.
 *
 * The one rule that matters here is the difference between a draft and a closed
 * report:
 *
 *  - a **draft** is computed live, so it moves when an entry is edited or the
 *    rounding rule changes — by design, and screen 16 says so;
 *  - a **closed** report renders exactly what it froze. Its lines come from the
 *    `staff_time_report_entries` snapshots, so a later rounding change, a rate
 *    change or an unlocked-and-edited entry cannot restate an invoice a client
 *    already holds (risk R1).
 *
 * Both paths go through the same `computeReportTotals`, which is what keeps the
 * preview, the sheet and the freeze records arithmetically identical.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { StaffTimeReport } from '../../data/entities'
import { loadReportData, type ReportDataScope } from './loadReportData'
import { normalizeReportGrouping } from './reportGroupings'
import {
  computeReportTotals,
  resolveReportCurrency,
  type ReportDirectory,
  type ReportGrouping,
  type ReportInputEntry,
  type ReportInputProject,
  type ReportNonBillableMode,
  type ReportTotals,
} from './reportTotals'

export type ReportSheetLabels = {
  unassignedTask: string
  unassignedPerson: string
  nonbillableGroup: string
}

export type BuildReportSheetInput = {
  em: EntityManager
  scope: ReportDataScope
  report: StaffTimeReport
  timeProjectIds: readonly string[]
  labels: ReportSheetLabels
  /** Overrides the report's stored grouping, for an export that re-groups. */
  grouping?: ReportGrouping
}

export type ReportSheet = {
  totals: ReportTotals
  entries: ReportInputEntry[]
  projects: ReportInputProject[]
  directory: ReportDirectory
  currencyCode: string | null
  grouping: ReportGrouping
  nonbillableMode: ReportNonBillableMode
  isClosed: boolean
}

function toDate(value: Date | string | null | undefined, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return fallback
}

export async function buildReportSheet(input: BuildReportSheetInput): Promise<ReportSheet> {
  const { em, scope, report, labels } = input
  const isClosed = report.status === 'closed'
  const grouping = normalizeReportGrouping(input.grouping ?? report.grouping)
  const nonbillableMode = report.nonbillableMode as ReportNonBillableMode

  const data = await loadReportData({
    em,
    scope,
    timeProjectIds: input.timeProjectIds,
    periodFrom: toDate(report.periodFrom, new Date(0)),
    periodTo: toDate(report.periodTo, new Date()),
  })

  // A closed report shows only what it froze. An entry logged into the period
  // AFTER the report closed is genuinely new work and belongs to the next
  // report — screen 15 note 2 is explicit that the lock covers entries, not
  // tasks, so logging more time on the same task must stay possible.
  const entries = isClosed
    ? data.entries.filter((entry) => entry.frozen?.reportId === report.id)
    : data.entries

  const totals = computeReportTotals({
    entries,
    projects: data.projects,
    directory: data.directory,
    options: {
      grouping,
      nonbillableMode,
      includeAlreadyReported: report.includeAlreadyReported ?? false,
    },
    currentReportId: report.id,
    labels,
  })

  const currency = resolveReportCurrency(
    data.projects.map((project) => ({
      id: project.id,
      name: project.name,
      currencyCode: project.currencyCode,
    })),
  )

  return {
    totals,
    entries,
    projects: data.projects,
    directory: data.directory,
    // A closed report keeps the currency it was closed with, even if a project
    // has since been relabelled (risk R11).
    currencyCode: isClosed ? report.currencyCode : currency.ok ? currency.currencyCode : report.currencyCode,
    grouping,
    nonbillableMode,
    isClosed,
  }
}
