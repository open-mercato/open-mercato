import type { PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

/**
 * Setting groups the unsaved-changes comparison tracks.
 *
 * `pageSize` is deliberately absent: `DataTable` never emits it from
 * `getCurrentSettings()`, so comparing it would report a permanent
 * false-positive for every saved view that carries one.
 */
export type DataTableViewSettingKey =
  | 'columnOrder'
  | 'columnVisibility'
  | 'columnSizing'
  | 'sorting'
  | 'filters'
  | 'searchValue'

/** Read-only view state handed to `DataTableProps.onColumnsDirtyChange`. */
export type DataTableViewDirtyState = {
  /** True when the live table settings differ from the last applied/saved view. */
  isDirty: boolean
  /** Which setting groups differ, in a stable order. */
  changedKeys: DataTableViewSettingKey[]
  /** `changedKeys.length` — ready to render as a badge counter. */
  changedCount: number
  /** The currently applied perspective (personal or role), if any. */
  activePerspectiveId: string | null
  /**
   * True when a save can target the active personal view without asking for a
   * name. Role perspectives and "No view" both yield false — those need the
   * views sidebar (or an explicit `name`) to save.
   */
  canSaveToActiveView: boolean
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`
}

function normalizeOrder(order: string[] | undefined, fallback: string[]): string[] {
  return Array.isArray(order) && order.length > 0 ? order : fallback
}

/**
 * `true` entries are equivalent to an absent entry: the column chooser deletes a
 * column's record when it is turned back on, so `{ name: true }` and `{}` both
 * mean "name is visible".
 */
function normalizeVisibility(visibility: Record<string, boolean> | undefined): Record<string, boolean> {
  if (!visibility) return {}
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(visibility)) {
    if (value === false) result[key] = false
  }
  return result
}

function normalizeSizing(sizing: Record<string, number> | undefined): Record<string, number> {
  if (!sizing) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(sizing)) {
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.round(value)
  }
  return result
}

function normalizeSorting(sorting: PerspectiveSettings['sorting']): Array<{ id: string; desc: boolean }> {
  if (!Array.isArray(sorting)) return []
  return sorting.map((entry) => ({ id: String(entry?.id ?? ''), desc: entry?.desc === true }))
}

function normalizeSearch(searchValue: string | undefined): string {
  return typeof searchValue === 'string' ? searchValue.trim() : ''
}

export type DiffPerspectiveSettingsOptions = {
  /**
   * Column ids in their natural (unordered) sequence. Used as the baseline for
   * `columnOrder` when neither side stored one, so a table that merely
   * materialized its default order is not reported as dirty.
   */
  defaultColumnOrder?: string[]
}

/**
 * Compare the live table settings against the settings of the last applied or
 * saved view and return the setting groups that differ.
 *
 * Both sides are expected to be sanitized (`sanitizePerspectiveSettings`), and
 * the comparison is intentionally value-based rather than reference-based so a
 * re-render alone never flips the result.
 */
export function diffPerspectiveSettings(
  base: PerspectiveSettings | null | undefined,
  current: PerspectiveSettings | null | undefined,
  options?: DiffPerspectiveSettingsOptions,
): DataTableViewSettingKey[] {
  const baseSettings = base ?? {}
  const currentSettings = current ?? {}
  const defaultColumnOrder = options?.defaultColumnOrder ?? []
  const changed: DataTableViewSettingKey[] = []

  const baseOrder = normalizeOrder(baseSettings.columnOrder, defaultColumnOrder)
  const currentOrder = normalizeOrder(currentSettings.columnOrder, defaultColumnOrder)
  if (stableStringify(baseOrder) !== stableStringify(currentOrder)) changed.push('columnOrder')

  if (
    stableStringify(normalizeVisibility(baseSettings.columnVisibility))
    !== stableStringify(normalizeVisibility(currentSettings.columnVisibility))
  ) changed.push('columnVisibility')

  if (
    stableStringify(normalizeSizing(baseSettings.columnSizing))
    !== stableStringify(normalizeSizing(currentSettings.columnSizing))
  ) changed.push('columnSizing')

  if (
    stableStringify(normalizeSorting(baseSettings.sorting))
    !== stableStringify(normalizeSorting(currentSettings.sorting))
  ) changed.push('sorting')

  if (stableStringify(baseSettings.filters ?? null) !== stableStringify(currentSettings.filters ?? null)) {
    changed.push('filters')
  }

  if (normalizeSearch(baseSettings.searchValue) !== normalizeSearch(currentSettings.searchValue)) {
    changed.push('searchValue')
  }

  return changed
}
