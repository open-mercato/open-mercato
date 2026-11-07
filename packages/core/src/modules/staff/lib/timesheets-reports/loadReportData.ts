/**
 * The one read that feeds every report surface: the live preview of screen 13,
 * the sheet of screen 14, the close command's freeze records and the exports.
 *
 * It is deliberately a single loader rather than one query per surface, because
 * a preview that counts different hours from the sheet it generates — or from
 * the snapshot the close writes — is the failure mode this whole phase exists to
 * prevent. Everything downstream consumes the same `ReportInputEntry[]`.
 *
 * Scoping is not optional here: every query carries `tenantId` and
 * `organizationId`, and the project ids are expected to have been narrowed by
 * `resolveProjectAccess` before they arrive.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  StaffTeamMember,
  StaffTimeEntry,
  StaffTimeProject,
  StaffTimeReport,
  StaffTimeReportEntry,
  StaffTimeTask,
} from '../../data/entities'
import type { FrozenEntryValues, ReportDirectory, ReportInputEntry, ReportInputProject } from './reportTotals'
import { decimalToString, parseDecimal } from '@open-mercato/shared/lib/decimal'

export type ReportDataScope = {
  tenantId: string
  organizationId: string
}

export type LoadReportDataInput = {
  em: EntityManager
  scope: ReportDataScope
  timeProjectIds: readonly string[]
  periodFrom: Date
  periodTo: Date
  /**
   * The report the data is being loaded for. An entry several closed reports
   * quote resolves to THIS report's freeze record when it has one.
   */
  currentReportId?: string | null
}

export type ReportData = {
  projects: ReportInputProject[]
  entries: ReportInputEntry[]
  directory: ReportDirectory
  /** Raw project rows, kept so callers can assert currency without a second read. */
  projectRows: StaffTimeProject[]
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function toExactOrNull(value: unknown): string | null {
  const parsed = parseDecimal(value)
  return parsed ? decimalToString(parsed) : null
}

function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

/**
 * D-2 caps nesting at one level, so a task's root is either itself or its
 * parent. The fallback to the task's own id keeps a line visible even if a
 * parent row has since been hard-removed.
 */
function resolveRootTaskId(taskId: string | null, parentById: ReadonlyMap<string, string | null>): string | null {
  if (!taskId) return null
  const parent = parentById.get(taskId)
  if (!parent) return taskId
  return parent
}

export async function loadReportData(input: LoadReportDataInput): Promise<ReportData> {
  const { em, scope, periodFrom, periodTo } = input
  const projectIds = Array.from(new Set(input.timeProjectIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (projectIds.length === 0) {
    return {
      projects: [],
      entries: [],
      directory: { taskLabelById: {}, personLabelById: {} },
      projectRows: [],
    }
  }

  const projectRows = await em.find(StaffTimeProject, {
    id: { $in: projectIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  const entryRows = await em.find(StaffTimeEntry, {
    timeProjectId: { $in: projectIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    date: { $gte: periodFrom, $lte: periodTo },
  })

  const taskIds = Array.from(
    new Set(entryRows.map((entry) => entry.taskId).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  )
  const taskRows =
    taskIds.length > 0
      ? await em.find(StaffTimeTask, {
          id: { $in: taskIds },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      : []

  // A child task's parent is not necessarily among the entries' tasks, so the
  // parents are fetched in a second pass to give the rolled-up line its label.
  const parentIds = Array.from(
    new Set(
      taskRows
        .map((task) => task.parentTaskId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && !taskIds.includes(id)),
    ),
  )
  const parentRows =
    parentIds.length > 0
      ? await em.find(StaffTimeTask, {
          id: { $in: parentIds },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      : []

  const parentById = new Map<string, string | null>()
  const taskLabelById: Record<string, string> = {}
  for (const task of [...taskRows, ...parentRows]) {
    parentById.set(task.id, task.parentTaskId ?? null)
    taskLabelById[task.id] = task.title
  }

  const staffMemberIds = Array.from(
    new Set(
      entryRows
        .map((entry) => entry.staffMemberId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const memberRows =
    staffMemberIds.length > 0
      ? await findWithDecryption(
          em,
          StaffTeamMember,
          {
            id: { $in: staffMemberIds },
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
          },
          {},
          scope,
        )
      : []
  const personLabelById: Record<string, string> = {}
  for (const member of memberRows) personLabelById[member.id] = member.displayName

  const frozenByEntryId = await loadFrozenValues(
    em,
    scope,
    entryRows.map((entry) => entry.id),
    { preferReportId: input.currentReportId ?? null },
  )

  const entries: ReportInputEntry[] = entryRows.map((entry) => ({
    id: entry.id,
    timeProjectId: entry.timeProjectId ?? '',
    taskId: entry.taskId ?? null,
    rootTaskId: resolveRootTaskId(entry.taskId ?? null, parentById),
    staffMemberId: entry.staffMemberId ?? null,
    date: toIsoDate(entry.date),
    durationMinutes: entry.durationMinutes ?? 0,
    roundedMinutes: entry.roundedMinutes ?? null,
    isBillable: entry.isBillable ?? true,
    rateOverrideAmount: toNumberOrNull(entry.rateOverrideAmount),
    rateOverrideAmountExact: toExactOrNull(entry.rateOverrideAmount),
    description: entry.notes ?? null,
    frozen: frozenByEntryId.get(entry.id) ?? null,
  }))

  const projects: ReportInputProject[] = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    hourlyRate: toNumberOrNull(project.hourlyRate),
    hourlyRateExact: toExactOrNull(project.hourlyRate),
    currencyCode: project.currencyCode ?? null,
  }))

  return {
    projects,
    entries,
    directory: { taskLabelById, personLabelById },
    projectRows,
  }
}

export type ClosedReportFreeze = {
  report: StaffTimeReport
  row: StaffTimeReportEntry
}

function closedAtTime(report: StaffTimeReport): number {
  const closedAt = report.closedAt
  if (closedAt instanceof Date && !Number.isNaN(closedAt.getTime())) return closedAt.getTime()
  return Number.POSITIVE_INFINITY
}

function compareClosedReportFreezes(left: ClosedReportFreeze, right: ClosedReportFreeze): number {
  const leftTime = closedAtTime(left.report)
  const rightTime = closedAtTime(right.report)
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1
  if (left.report.id === right.report.id) return 0
  return left.report.id < right.report.id ? -1 : 1
}

/**
 * Every freeze record a **closed** report holds for the given entries. The D-5
 * opt-in lets a later report re-include an hour an earlier one already froze,
 * so one entry can be quoted by several closed reports; each list is ordered by
 * the moment its report closed (report id as the tie-break), which makes the
 * first item the report that billed the hour first.
 */
export async function loadClosedReportFreezes(
  em: EntityManager,
  scope: ReportDataScope,
  timeEntryIds: readonly string[],
): Promise<Map<string, ClosedReportFreeze[]>> {
  const ids = Array.from(new Set(timeEntryIds.filter((id) => typeof id === 'string' && id.length > 0)))
  const result = new Map<string, ClosedReportFreeze[]>()
  if (ids.length === 0) return result

  const rows = await em.find(StaffTimeReportEntry, {
    timeEntryId: { $in: ids },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (rows.length === 0) return result

  const reportIds = Array.from(new Set(rows.map((row) => row.reportId)))
  const reports = await em.find(StaffTimeReport, {
    id: { $in: reportIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'closed',
    deletedAt: null,
  })
  const reportById = new Map(reports.map((report) => [report.id, report]))

  for (const row of rows) {
    const report = reportById.get(row.reportId)
    if (!report) continue
    const bucket = result.get(row.timeEntryId)
    if (bucket) bucket.push({ report, row })
    else result.set(row.timeEntryId, [{ report, row }])
  }
  for (const bucket of result.values()) bucket.sort(compareClosedReportFreezes)

  return result
}

/**
 * D-5's indexed lookup. `staff_time_report_entries` is authoritative for "has
 * this hour been billed already?", and only rows belonging to a **closed**
 * report count: a freeze record left behind by a report that has since been
 * unlocked must not keep an hour out of the next invoice.
 *
 * When several closed reports quote one entry, `preferReportId` picks that
 * report's own record — a closed report must be able to find what it froze no
 * matter who else re-included the hour. Without a preferred report the earliest
 * closed one answers, so the already-reported source named is stable.
 */
export async function loadFrozenValues(
  em: EntityManager,
  scope: ReportDataScope,
  timeEntryIds: readonly string[],
  options: { preferReportId?: string | null } = {},
): Promise<Map<string, FrozenEntryValues>> {
  const result = new Map<string, FrozenEntryValues>()
  const freezesByEntryId = await loadClosedReportFreezes(em, scope, timeEntryIds)
  const preferReportId = options.preferReportId ?? null

  for (const [timeEntryId, freezes] of freezesByEntryId) {
    const chosen =
      (preferReportId ? freezes.find((freeze) => freeze.report.id === preferReportId) : undefined) ?? freezes[0]
    if (!chosen) continue
    const { report, row } = chosen
    result.set(timeEntryId, {
      reportId: report.id,
      reference: report.reference ?? null,
      title: report.title ?? null,
      rawMinutes: row.frozenRawMinutes ?? 0,
      roundedMinutes: row.frozenRoundedMinutes ?? 0,
      rateAmount: toNumberOrNull(row.frozenRateAmount),
      rateAmountExact: toExactOrNull(row.frozenRateAmount),
      currencyCode: row.frozenCurrencyCode ?? null,
      amount: toNumberOrNull(row.frozenAmount),
      amountExact: toExactOrNull(row.frozenAmount),
      isBillable: row.frozenIsBillable ?? true,
    })
  }

  return result
}
