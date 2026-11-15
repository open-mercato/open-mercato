/**
 * The raw, one-line-per-entry view of a report.
 *
 * Screen 14 note 3: the PDF mirrors the grouped sheet, while CSV and XLSX add
 * the raw columns accounting actually needs — date, person, description — which
 * the grouped sheet deliberately does not print for a client. Screen 15's
 * "locked entries" table reads the same rows.
 *
 * Amounts come from `resolveEntryValues`, the same function the grouped sheet
 * and the freeze records use, so an accountant reconciling the CSV against the
 * PDF total never finds a discrepancy.
 */

import { formatReportMinutes, resolveEntryValues, sumAmounts } from './reportTotals'
import type { ReportDirectory, ReportInputEntry, ReportInputProject } from './reportTotals'

export type ReportRow = {
  entryId: string
  date: string
  projectId: string
  projectName: string
  taskLabel: string
  personLabel: string
  description: string
  rawMinutes: number
  minutes: number
  hours: string
  isBillable: boolean
  rate: number | null
  amount: number | null
  hasOverride: boolean
  isFrozen: boolean
}

export type BuildReportRowsInput = {
  entries: readonly ReportInputEntry[]
  projects: readonly ReportInputProject[]
  directory: ReportDirectory
  labels: { unassignedTask: string; unassignedPerson: string }
}

export function buildReportRows(input: BuildReportRowsInput): ReportRow[] {
  const projectById = new Map(input.projects.map((project) => [project.id, project]))
  const rows = input.entries.map((entry) => {
    const project = projectById.get(entry.timeProjectId) ?? null
    const values = resolveEntryValues(entry, project)
    const taskId = entry.taskId ?? null
    return {
      entryId: entry.id,
      date: entry.date,
      projectId: entry.timeProjectId,
      projectName: project?.name ?? entry.timeProjectId,
      taskLabel: (taskId ? input.directory.taskLabelById[taskId] : null) ?? input.labels.unassignedTask,
      personLabel:
        (entry.staffMemberId ? input.directory.personLabelById[entry.staffMemberId] : null) ??
        input.labels.unassignedPerson,
      description: entry.description ?? '',
      rawMinutes: values.rawMinutes,
      minutes: values.minutes,
      hours: formatReportMinutes(values.minutes),
      isBillable: values.isBillable,
      rate: values.rate,
      amount: values.amount,
      hasOverride: values.hasOverride,
      isFrozen: values.isFrozen,
    } satisfies ReportRow
  })

  rows.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.projectName.localeCompare(right.projectName) ||
      left.taskLabel.localeCompare(right.taskLabel),
  )
  return rows
}

/**
 * The rows' amounts add up to the report's grand total by construction — same
 * per-entry values, summed in integer cents. Exposed so the export and the
 * screen can assert it rather than assume it.
 */
export function sumReportRowAmounts(rows: readonly ReportRow[]): number {
  return sumAmounts(rows.map((row) => row.amount))
}

export function sumReportRowMinutes(rows: readonly ReportRow[], billable: boolean): number {
  return rows.reduce((total, row) => (row.isBillable === billable ? total + row.minutes : total), 0)
}
