import type { Module, ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { DashboardWidgetMetadata, DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

type LoadedWidgetModule = DashboardWidgetModule<any> & { metadata: DashboardWidgetMetadata }

type WidgetEntry = ModuleDashboardWidgetEntry & { moduleId: string }

let widgetEntriesPromise: Promise<WidgetEntry[]> | null = null

/**
 * Invalidate the widget entries and widget module cache.
 * Call this when the generated registry is updated or modules are reloaded.
 */
export function invalidateWidgetCache() {
  widgetEntriesPromise = null;
  widgetCache.clear();
}
async function loadWidgetEntries(): Promise<WidgetEntry[]> {
  if (!widgetEntriesPromise) {
    widgetEntriesPromise = import('@/generated/modules.generated').then((registry) => {
      const list = (registry.modules ?? []) as Module[]
      return list.flatMap((mod) => {
        const entries = mod.dashboardWidgets ?? []
        return entries.map((entry) => ({
          ...entry,
          moduleId: mod.id,
        }))
      })
    })
  }
  return widgetEntriesPromise
}

const widgetCache = new Map<string, Promise<LoadedWidgetModule>>()

function ensureValidWidgetModule(mod: any, key: string, moduleId: string): LoadedWidgetModule {
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Invalid dashboard widget module "${key}" from "${moduleId}" (expected object export)`)
  }
  const widget = (mod.default ?? mod) as DashboardWidgetModule<any>
  if (!widget || typeof widget !== 'object') {
    throw new Error(`Invalid dashboard widget export "${key}" from "${moduleId}" (missing default export)`)
  }
  if (!widget.metadata || typeof widget.metadata !== 'object') {
    throw new Error(`Dashboard widget "${key}" from "${moduleId}" is missing metadata`)
  }
  const { metadata } = widget
  if (typeof metadata.id !== 'string' || metadata.id.length === 0) {
    throw new Error(`Dashboard widget "${key}" from "${moduleId}" metadata.id must be a non-empty string`)
  }
  if (typeof metadata.title !== 'string' || metadata.title.length === 0) {
    throw new Error(`Dashboard widget "${metadata.id}" from "${moduleId}" must have a title`)
  }
  return {
    ...widget,
    metadata,
  }
}

async function loadEntry(entry: WidgetEntry): Promise<LoadedWidgetModule> {
  if (!widgetCache.has(entry.key)) {
    const promise = entry.loader()
      .then((mod) => ensureValidWidgetModule(mod, entry.key, entry.moduleId))
    widgetCache.set(entry.key, promise)
  }
  return widgetCache.get(entry.key)!
}

export async function loadAllWidgets(): Promise<Array<LoadedWidgetModule & { moduleId: string; key: string }>> {
  const widgetEntries = await loadWidgetEntries()
  const loaded = await Promise.all(widgetEntries.map(async (entry) => {
    const widget = await loadEntry(entry)
    return { ...widget, moduleId: entry.moduleId, key: entry.key }
  }))
  const byId = new Map<string, LoadedWidgetModule & { moduleId: string; key: string }>()
  for (const widget of loaded) {
    if (!byId.has(widget.metadata.id)) {
      byId.set(widget.metadata.id, widget)
    }
  }
  return Array.from(byId.values())
}

export async function loadWidgetById(widgetId: string): Promise<(LoadedWidgetModule & { moduleId: string; key: string }) | null> {
  const widgetEntries = await loadWidgetEntries()
  for (const entry of widgetEntries) {
    const widget = await loadEntry(entry)
    if (widget.metadata.id === widgetId) {
      return { ...widget, moduleId: entry.moduleId, key: entry.key }
    }
  }
  return null
}
