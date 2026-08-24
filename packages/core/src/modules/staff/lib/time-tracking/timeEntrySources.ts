/**
 * EP-37 — the time-entry source registry.
 *
 * `staff_time_entries.source` used to be a four-value database enum, which made
 * every import integration a core patch. It is now a plain text column whose
 * accepted values are this registry, so a `jira`, `toggl` or `badge-terminal`
 * source ships with its contributing module.
 *
 * `editable` is the flag the entry screens read: a source the user may still
 * hand-correct (`manual`) versus one whose numbers belong to the system that
 * produced them. It is advisory metadata, not an authorization decision — the
 * lock rules stay with `locked_report_id` and the ACL features.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'

export const BUILT_IN_TIME_ENTRY_SOURCE_IDS = ['manual', 'timer', 'kiosk', 'mobile'] as const

export type BuiltInTimeEntrySource = (typeof BUILT_IN_TIME_ENTRY_SOURCE_IDS)[number]

/**
 * Widened from the original four-value union so a contributed id is assignable.
 * The union arm keeps the four built-ins as completions.
 */
export type TimeEntrySource = BuiltInTimeEntrySource | (string & {})

export type TimeEntrySourceDefinition = {
  id: string
  labelKey: string
  /** Lucide icon name the entry screens may render beside the row. */
  icon: string
  editable: boolean
  priority?: number
}

export const TIME_ENTRY_SOURCE_REGISTRY_ID = extensionPoints.hosts.timeEntrySourceRegistry.spotId

export const DEFAULT_TIME_ENTRY_SOURCE: BuiltInTimeEntrySource = 'manual'

const registry = createStrategyRegistry<TimeEntrySourceDefinition>(TIME_ENTRY_SOURCE_REGISTRY_ID)

export function registerTimeEntrySource(source: TimeEntrySourceDefinition): () => void {
  return registry.register(source)
}

export function listTimeEntrySources(): TimeEntrySourceDefinition[] {
  return registry.list()
}

export function getTimeEntrySource(id: string | null | undefined): TimeEntrySourceDefinition | null {
  return registry.get(id)
}

export function hasTimeEntrySource(id: string | null | undefined): boolean {
  return registry.has(id)
}

/** Built-ins first, in the order the module shipped them, then contributions. */
export function timeEntrySourceIds(): string[] {
  const builtIn = BUILT_IN_TIME_ENTRY_SOURCE_IDS.filter((id) => registry.has(id))
  const contributed = registry.ids().filter((id) => !builtIn.includes(id as BuiltInTimeEntrySource))
  return [...builtIn, ...contributed]
}

/**
 * The write-path guard the dropped database check constraint used to provide.
 * An unknown id falls back to `manual` rather than rejecting the write, matching
 * the column default the enum carried.
 */
export function normalizeTimeEntrySource(value: unknown): TimeEntrySource {
  if (typeof value === 'string' && registry.has(value)) return value
  return DEFAULT_TIME_ENTRY_SOURCE
}

const builtInSources: readonly Omit<TimeEntrySourceDefinition, 'priority'>[] = [
  { id: 'manual', labelKey: 'staff.time_tracking.entries.source.manual', icon: 'PenLine', editable: true },
  { id: 'timer', labelKey: 'staff.time_tracking.entries.source.timer', icon: 'Timer', editable: true },
  { id: 'kiosk', labelKey: 'staff.time_tracking.entries.source.kiosk', icon: 'Monitor', editable: false },
  { id: 'mobile', labelKey: 'staff.time_tracking.entries.source.mobile', icon: 'Smartphone', editable: true },
]

for (const source of builtInSources) {
  registerTimeEntrySource({ ...source, priority: BUILT_IN_STRATEGY_PRIORITY })
}
