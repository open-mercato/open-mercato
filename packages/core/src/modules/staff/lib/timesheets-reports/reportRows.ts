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

import { decimalToNumber } from '@open-mercato/shared/lib/decimal'
import { DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES } from '../time-tracking/cost'
import { formatReportMinutes, resolveEntryValues, sumResolvedAmounts } from './reportTotals'
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
  rateExact?: string | null
  amount: number | null
  amountExact?: string | null
  hasOverride: boolean
  isFrozen: boolean
}

export type BuildReportRowsInput = {
  entries: readonly ReportInputEntry[]
  projects: readonly ReportInputProject[]
  directory: ReportDirectory
  labels: { unassignedTask: string; unassignedPerson: string }
  /** Decimals amounts round to (the report currency's); defaults to 2. */
  amountDecimalPlaces?: number
}

export function buildReportRows(input: BuildReportRowsInput): ReportRow[] {
  const projectById = new Map(input.projects.map((project) => [project.id, project]))
  const rows = input.entries.map((entry) => {
    const project = projectById.get(entry.timeProjectId) ?? null
    const values = resolveEntryValues(entry, project, input.amountDecimalPlaces)
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
      rateExact: values.rateExact,
      amount: values.amount,
      amountExact: values.amountExact,
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
 * The rows' amounts summed the way the grand total is (`sumResolvedAmounts`):
 * live amounts at the currency decimals, frozen amounts exactly as billed. Built
 * from the same rows and decimals, it equals `totalAmountExact`, so the export
 * and the screen can assert that rather than assume it.
 */
export function sumReportRowAmountsExact(
  rows: readonly ReportRow[],
  amountDecimalPlaces: number = DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES,
): string {
  const values = rows.map((row) => ({
    isFrozen: row.isFrozen,
    amountExact: row.amountExact ?? (row.amount === null ? null : String(row.amount)),
  }))
  return sumResolvedAmounts(values, amountDecimalPlaces)
}

export function sumReportRowAmounts(
  rows: readonly ReportRow[],
  amountDecimalPlaces: number = DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES,
): number {
  return decimalToNumber(sumReportRowAmountsExact(rows, amountDecimalPlaces))
}

export function sumReportRowMinutes(rows: readonly ReportRow[], billable: boolean): number {
  return rows.reduce((total, row) => (row.isBillable === billable ? total + row.minutes : total), 0)
}
