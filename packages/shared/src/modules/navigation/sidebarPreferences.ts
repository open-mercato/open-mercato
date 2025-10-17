export const SIDEBAR_PREFERENCES_VERSION = 1

export type SidebarPreferencesSettings = {
  version: number
  groupOrder?: string[]
  groupLabels?: Record<string, string>
  itemLabels?: Record<string, string>
}

export type SidebarPreferencesPayload = {
  locale: string
  settings: SidebarPreferencesSettings
}

export function normalizeSidebarSettings(settings?: SidebarPreferencesSettings | null): SidebarPreferencesSettings {
  if (!settings || typeof settings !== 'object') {
    return { version: SIDEBAR_PREFERENCES_VERSION, groupOrder: [], groupLabels: {}, itemLabels: {} }
  }
  const version = typeof settings.version === 'number' ? settings.version : SIDEBAR_PREFERENCES_VERSION
  const groupOrder = Array.isArray(settings.groupOrder) ? settings.groupOrder.filter((v): v is string => typeof v === 'string') : []
  const groupLabels = normalizeRecord(settings.groupLabels)
  const itemLabels = normalizeRecord(settings.itemLabels)
  return {
    version,
    groupOrder,
    groupLabels,
    itemLabels,
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

export function slugifySidebarId(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'group'
}
