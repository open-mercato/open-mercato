import type {
  DashboardDateRangeCompare,
  DashboardDateRangePreset,
  DashboardLayoutItem,
  DashboardWidgetAccent,
  DashboardWidgetSize,
} from '@open-mercato/shared/modules/dashboard/widgets'

export type DashboardLayoutPreferences = {
  dateRange?: {
    preset: DashboardDateRangePreset
    from?: string
    to?: string
    compare: DashboardDateRangeCompare
  }
}

export type DashboardLayoutPreset = {
  id: string
  name: string
  items: DashboardLayoutItem[]
  preferences?: DashboardLayoutPreferences
}

export type DashboardLayoutState = {
  items: DashboardLayoutItem[]
  preferences?: DashboardLayoutPreferences
  presets?: DashboardLayoutPreset[]
  activePresetId?: string
}

export const MAX_DASHBOARD_PRESETS = 12
const MAX_PRESET_NAME_LENGTH = 80

const WIDGET_SIZES = ['sm', 'md', 'lg', 'full'] as const satisfies readonly DashboardWidgetSize[]
const WIDGET_ACCENTS = ['neutral', 'info', 'success', 'warning', 'error', 'brand'] as const satisfies readonly DashboardWidgetAccent[]
const DATE_RANGE_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'custom',
] as const satisfies readonly DashboardDateRangePreset[]
const DATE_RANGE_COMPARE = ['previous_period', 'previous_year', 'none'] as const satisfies readonly DashboardDateRangeCompare[]
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDashboardWidgetSize(value: unknown): value is DashboardWidgetSize {
  return typeof value === 'string' && WIDGET_SIZES.some((size) => size === value)
}

function isDashboardWidgetAccent(value: unknown): value is DashboardWidgetAccent {
  return typeof value === 'string' && WIDGET_ACCENTS.some((accent) => accent === value)
}

function isDashboardDateRangePreset(value: unknown): value is DashboardDateRangePreset {
  return typeof value === 'string' && DATE_RANGE_PRESETS.some((preset) => preset === value)
}

function isDashboardDateRangeCompare(value: unknown): value is DashboardDateRangeCompare {
  return typeof value === 'string' && DATE_RANGE_COMPARE.some((compare) => compare === value)
}

function isoDateToUtcMs(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) return null
  const [yearPart, monthPart, dayPart] = value.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && isoDateToUtcMs(value) !== null
}

function integerOrUndefined(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined
}

export function normalizeLayoutItems(raw: unknown): DashboardLayoutItem[] {
  const list = Array.isArray(raw) ? raw : []
  const seenIds = new Set<string>()

  return list
    .filter(isRecord)
    .map((item) => ({
      id: String(item.id),
      widgetId: String(item.widgetId),
      order: integerOrUndefined(item.order),
      priority: integerOrUndefined(item.priority),
      size: isDashboardWidgetSize(item.size) ? item.size : undefined,
      accent: isDashboardWidgetAccent(item.accent) ? item.accent : undefined,
      settings: item.settings,
    }))
    .filter((item) => {
      if (!item.id || !item.widgetId) return false
      if (seenIds.has(item.id)) return false
      seenIds.add(item.id)
      return true
    })
    .sort((a, b) => {
      const aOrder = a.order ?? a.priority ?? 0
      const bOrder = b.order ?? b.priority ?? 0
      return aOrder - bOrder
    })
    .map((item, idx) => ({
      ...item,
      order: idx,
      priority: idx,
    }))
}

function normalizeDateRangePreference(raw: unknown): DashboardLayoutPreferences['dateRange'] | undefined {
  if (!isRecord(raw)) return undefined
  if (!isDashboardDateRangePreset(raw.preset) || !isDashboardDateRangeCompare(raw.compare)) return undefined

  const from = isIsoDate(raw.from) ? raw.from : undefined
  const to = isIsoDate(raw.to) ? raw.to : undefined

  if (raw.preset === 'custom') {
    if (!from || !to) return undefined
    const fromTime = isoDateToUtcMs(from)
    const toTime = isoDateToUtcMs(to)
    if (fromTime === null || toTime === null || fromTime > toTime) return undefined
  }

  return {
    preset: raw.preset,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    compare: raw.compare,
  }
}

function normalizePreferences(raw: unknown): DashboardLayoutPreferences | undefined {
  if (!isRecord(raw)) return undefined

  const preferences: DashboardLayoutPreferences = {}
  if (Object.prototype.hasOwnProperty.call(raw, 'dateRange')) {
    const dateRange = normalizeDateRangePreference(raw.dateRange)
    if (dateRange) {
      preferences.dateRange = dateRange
    }
  }

  return preferences
}

function normalizePreset(raw: unknown): DashboardLayoutPreset | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_PRESET_NAME_LENGTH) : ''
  if (!id || !name) return null
  const preferences = normalizePreferences(raw.preferences)
  return {
    id,
    name,
    items: normalizeLayoutItems(raw.items),
    ...(preferences ? { preferences } : {}),
  }
}

export function normalizePresets(raw: unknown): DashboardLayoutPreset[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const presets: DashboardLayoutPreset[] = []
  for (const entry of raw) {
    const preset = normalizePreset(entry)
    if (!preset || seen.has(preset.id)) continue
    seen.add(preset.id)
    presets.push(preset)
    if (presets.length >= MAX_DASHBOARD_PRESETS) break
  }
  return presets.length > 0 ? presets : undefined
}

function isLayoutStateObject(raw: unknown): raw is { items: unknown; preferences?: unknown; presets?: unknown; activePresetId?: unknown } {
  return isRecord(raw) && Array.isArray(raw.items)
}

export function isLegacyLayoutArray(raw: unknown): boolean {
  return Array.isArray(raw)
}

export function normalizeLayoutState(raw: unknown): DashboardLayoutState {
  if (Array.isArray(raw)) {
    return { items: normalizeLayoutItems(raw) }
  }

  if (isLayoutStateObject(raw)) {
    const preferences = normalizePreferences(raw.preferences)
    const presets = normalizePresets(raw.presets)
    const activePresetId =
      presets && typeof raw.activePresetId === 'string' && presets.some((preset) => preset.id === raw.activePresetId)
        ? raw.activePresetId
        : undefined
    return {
      items: normalizeLayoutItems(raw.items),
      ...(preferences ? { preferences } : {}),
      ...(presets ? { presets } : {}),
      ...(activePresetId ? { activePresetId } : {}),
    }
  }

  return { items: [] }
}

export function serializeLayoutStateForStoredShape(
  raw: unknown,
  state: DashboardLayoutState,
): DashboardLayoutItem[] | DashboardLayoutState {
  if (isLegacyLayoutArray(raw)) {
    return state.items
  }

  return {
    items: state.items,
    ...(state.preferences ? { preferences: state.preferences } : {}),
    ...(state.presets ? { presets: state.presets } : {}),
    ...(state.activePresetId ? { activePresetId: state.activePresetId } : {}),
  }
}
