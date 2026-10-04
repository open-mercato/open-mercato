/**
 * EP-36 — the report grouping strategy registry.
 *
 * A grouping decides two things and nothing else: which line an entry lands on
 * (`groupOf`, which may name a parent line so D-2's inclusive task rollup keeps
 * working) and how the finished lines are ordered (`sort`). Labelling is a third
 * concern the strategy owns because only it knows which directory to look the
 * key up in.
 *
 * The three built-ins reproduce `reportTotals.ts`'s original `lineKeyFor` /
 * `labelFor` / line sort exactly. The registry lives in its own file so
 * `reportTotals.ts` can register into it at module load without an import cycle.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from '../time-tracking/registries/registry'
import type { ReportDirectory, ReportInputEntry, ReportLine } from './reportTotals'

export const BUILT_IN_REPORT_GROUPING_IDS = ['project_task', 'project_person', 'project_day'] as const

export type BuiltInReportGrouping = (typeof BUILT_IN_REPORT_GROUPING_IDS)[number]

/**
 * Widened from the original three-way union so a contributed grouping id is
 * assignable. The union arm keeps the built-ins as completions.
 */
export type ReportGrouping = BuiltInReportGrouping | (string & {})

export type ReportGroupingFallbackLabels = {
  unassignedTask: string
  unassignedPerson: string
  nonbillableGroup: string
}

export type ReportGroupingLabelContext = {
  directory: ReportDirectory
  fallbacks: ReportGroupingFallbackLabels
}

export type ReportGroupingKey = {
  key: string
  parentKey: string | null
}

export type ReportGroupingStrategy = {
  id: string
  labelKey: string
  priority?: number
  groupOf(entry: ReportInputEntry): ReportGroupingKey
  labelOf(key: string, ctx: ReportGroupingLabelContext): string
  sort(left: ReportLine, right: ReportLine): number
}

export const REPORT_GROUPING_REGISTRY_ID = extensionPoints.hosts.reportGroupingRegistry.spotId

const registry = createStrategyRegistry<ReportGroupingStrategy>(REPORT_GROUPING_REGISTRY_ID)

export function registerReportGrouping(grouping: ReportGroupingStrategy): () => void {
  return registry.register(grouping)
}

export function listReportGroupings(): ReportGroupingStrategy[] {
  return registry.list()
}

export function getReportGrouping(id: string | null | undefined): ReportGroupingStrategy | null {
  return registry.get(id)
}

export function hasReportGrouping(id: string | null | undefined): boolean {
  return registry.has(id)
}

/** Identity, not membership of `BUILT_IN_REPORT_GROUPING_IDS` — a contribution cannot claim one. */
export function isBuiltInReportGrouping(id: string | null | undefined): boolean {
  return registry.isBuiltIn(id)
}

/** Built-ins first, in the order the module shipped them, then contributions. */
export function reportGroupingIds(): string[] {
  const builtIn = BUILT_IN_REPORT_GROUPING_IDS.filter((id) => registry.has(id))
  const contributed = registry.ids().filter((id) => !builtIn.includes(id as BuiltInReportGrouping))
  return [...builtIn, ...contributed]
}

export const DEFAULT_REPORT_GROUPING: BuiltInReportGrouping = 'project_task'

/**
 * The grouping a report was stored with, coerced back to something the registry
 * can serve. An id whose contributing module has since been removed falls back
 * to the module default rather than producing an ungrouped sheet.
 */
export function normalizeReportGrouping(value: unknown): ReportGrouping {
  if (typeof value === 'string' && registry.has(value)) return value
  return DEFAULT_REPORT_GROUPING
}

/**
 * The line key an entry with nothing to group by lands on. It is part of the
 * grouping contract rather than a `reportTotals` private, because a contributed
 * grouping has to be able to produce the same "unassigned" bucket.
 */
export const UNASSIGNED_LINE_KEY = '__unassigned__'

/** The line ordering every built-in grouping shares: longest first, then by label. */
function sortByMinutesThenLabel(left: ReportLine, right: ReportLine): number {
  return right.minutes - left.minutes || left.label.localeCompare(right.label)
}

function taskLineKey(entry: ReportInputEntry): ReportGroupingKey {
  const rootId = entry.rootTaskId ?? entry.taskId ?? null
  const taskId = entry.taskId ?? null
  if (!rootId) return { key: UNASSIGNED_LINE_KEY, parentKey: null }
  // D-2: a child's time lands on the parent's line and is expandable underneath.
  if (taskId && taskId !== rootId) return { key: taskId, parentKey: rootId }
  return { key: rootId, parentKey: null }
}

function registerBuiltInReportGrouping(
  grouping: Omit<ReportGroupingStrategy, 'priority'>,
): ReportGroupingStrategy {
  return registry.registerBuiltIn({ ...grouping, priority: BUILT_IN_STRATEGY_PRIORITY })
}

registerBuiltInReportGrouping({
  id: 'project_task',
  labelKey: 'staff.time_tracking.reports.grouping.project_task',
  groupOf: taskLineKey,
  labelOf: (key, ctx) =>
    key === UNASSIGNED_LINE_KEY
      ? ctx.fallbacks.unassignedTask
      : ctx.directory.taskLabelById[key] ?? ctx.fallbacks.unassignedTask,
  sort: sortByMinutesThenLabel,
})

registerBuiltInReportGrouping({
  id: 'project_person',
  labelKey: 'staff.time_tracking.reports.grouping.project_person',
  groupOf: (entry) => ({ key: entry.staffMemberId ?? UNASSIGNED_LINE_KEY, parentKey: null }),
  labelOf: (key, ctx) =>
    key === UNASSIGNED_LINE_KEY
      ? ctx.fallbacks.unassignedPerson
      : ctx.directory.personLabelById[key] ?? ctx.fallbacks.unassignedPerson,
  sort: sortByMinutesThenLabel,
})

registerBuiltInReportGrouping({
  id: 'project_day',
  labelKey: 'staff.time_tracking.reports.grouping.project_day',
  groupOf: (entry) => ({ key: entry.date || UNASSIGNED_LINE_KEY, parentKey: null }),
  labelOf: (key, ctx) => (key === UNASSIGNED_LINE_KEY ? ctx.fallbacks.unassignedTask : key),
  sort: sortByMinutesThenLabel,
})
