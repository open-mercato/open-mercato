import { slugify } from '../../lib/slugify'

export const SIDEBAR_PREFERENCES_VERSION = 2

export type SidebarPreferencesSettings = {
  version: number
  groupOrder?: string[]
  groupLabels?: Record<string, string>
  itemLabels?: Record<string, string>
  hiddenItems?: string[]
  /** Per-group ordered list of item keys. Missing items keep their natural position. */
  itemOrder?: Record<string, string[]>
}

export type SidebarPreferencesPayload = {
  locale: string
  settings: SidebarPreferencesSettings
}

export function normalizeSidebarSettings(settings?: SidebarPreferencesSettings | null): SidebarPreferencesSettings {
  if (!settings || typeof settings !== 'object') {
    return { version: SIDEBAR_PREFERENCES_VERSION, groupOrder: [], groupLabels: {}, itemLabels: {}, hiddenItems: [], itemOrder: {} }
  }
  const version = typeof settings.version === 'number' ? settings.version : SIDEBAR_PREFERENCES_VERSION
  const groupOrder = Array.isArray(settings.groupOrder) ? settings.groupOrder.filter((v): v is string => typeof v === 'string') : []
  const groupLabels = normalizeRecord(settings.groupLabels)
  const itemLabels = normalizeRecord(settings.itemLabels)
  const hiddenItems = normalizeStringArray(settings.hiddenItems)
  const itemOrder = normalizeStringArrayRecord(settings.itemOrder)
  return {
    version,
    groupOrder,
    groupLabels,
    itemLabels,
    hiddenItems,
    itemOrder,
  }
}

function normalizeRecord(record: Record<string, unknown> | undefined): Record<string, string> {
  if (!record || typeof record !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') continue
    out[key] = value
  }
  return out
}

function normalizeStringArrayRecord(record: Record<string, unknown> | undefined): Record<string, string[]> {
  if (!record || typeof record !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(record)) {
    const arr = normalizeStringArray(value)
    if (arr.length > 0) out[key] = arr
  }
  return out
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function slugifySidebarId(source: string): string {
  return slugify(source, { allowedChars: '' }) || 'group'
}
