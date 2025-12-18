import type { Module, ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { InjectionWidgetMetadata, InjectionWidgetModule, InjectionSpotId, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

type LoadedWidgetModule = InjectionWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }

type WidgetEntry = ModuleInjectionWidgetEntry & { moduleId: string }

let widgetEntriesPromise: Promise<WidgetEntry[]> | null = null
let injectionTablePromise: Promise<Map<InjectionSpotId, Array<{ widgetId: string; moduleId: string; priority: number }>>> | null = null

/**
 * Invalidate the widget entries and widget module cache.
 * Call this when the generated registry is updated or modules are reloaded.
 */
export function invalidateInjectionWidgetCache() {
  widgetEntriesPromise = null
  injectionTablePromise = null
  widgetCache.clear()
}

async function loadWidgetEntries(): Promise<WidgetEntry[]> {
  if (!widgetEntriesPromise) {
    widgetEntriesPromise = import('@/generated/modules.generated').then((registry) => {
      const list = (registry.modules ?? []) as Module[]
      return list.flatMap((mod) => {
        const entries = mod.injectionWidgets ?? []
        return entries.map((entry) => ({
          ...entry,
          moduleId: mod.id,
        }))
      })
    })
  }
  return widgetEntriesPromise
}

async function loadInjectionTable(): Promise<Map<InjectionSpotId, Array<{ widgetId: string; moduleId: string; priority: number }>>> {
  if (!injectionTablePromise) {
    injectionTablePromise = import('@/generated/modules.generated').then((registry) => {
      const list = (registry.modules ?? []) as Module[]
      const table = new Map<InjectionSpotId, Array<{ widgetId: string; moduleId: string; priority: number }>>()
      
      for (const mod of list) {
        const injectionTable = (mod.injectionTable ?? {}) as ModuleInjectionTable
        for (const [spotId, widgetIds] of Object.entries(injectionTable)) {
          const widgets = Array.isArray(widgetIds) ? widgetIds : [widgetIds]
          const existing = table.get(spotId) ?? []
          for (const widgetId of widgets) {
            existing.push({ widgetId, moduleId: mod.id, priority: 0 })
          }
          table.set(spotId, existing)
        }
      }
      
      // Sort by priority (higher priority first)
      for (const [spotId, widgets] of table.entries()) {
        table.set(spotId, widgets.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)))
      }
      
      return table
    })
  }
  return injectionTablePromise
}

const widgetCache = new Map<string, Promise<LoadedWidgetModule>>()

function ensureValidWidgetModule(mod: any, key: string, moduleId: string): LoadedWidgetModule {
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Invalid injection widget module "${key}" from "${moduleId}" (expected object export)`)
  }
  const widget = (mod.default ?? mod) as InjectionWidgetModule<any, any>
  if (!widget || typeof widget !== 'object') {
    throw new Error(`Invalid injection widget export "${key}" from "${moduleId}" (missing default export)`)
  }
  if (!widget.metadata || typeof widget.metadata !== 'object') {
    throw new Error(`Injection widget "${key}" from "${moduleId}" is missing metadata`)
  }
  const { metadata } = widget
  if (typeof metadata.id !== 'string' || metadata.id.length === 0) {
    throw new Error(`Injection widget "${key}" from "${moduleId}" metadata.id must be a non-empty string`)
  }
  if (typeof metadata.title !== 'string' || metadata.title.length === 0) {
    throw new Error(`Injection widget "${metadata.id}" from "${moduleId}" must have a title`)
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

export async function loadAllInjectionWidgets(): Promise<Array<LoadedWidgetModule & { moduleId: string; key: string }>> {
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

export async function loadInjectionWidgetById(widgetId: string): Promise<(LoadedWidgetModule & { moduleId: string; key: string }) | null> {
  const widgetEntries = await loadWidgetEntries()
  for (const entry of widgetEntries) {
    const widget = await loadEntry(entry)
    if (widget.metadata.id === widgetId) {
      return { ...widget, moduleId: entry.moduleId, key: entry.key }
    }
  }
  return null
}

export async function loadInjectionWidgetsForSpot(spotId: InjectionSpotId): Promise<Array<LoadedWidgetModule & { moduleId: string; key: string }>> {
  const table = await loadInjectionTable()
  const entries = table.get(spotId) ?? []
  const widgets = await Promise.all(
    entries.map(async ({ widgetId }) => {
      const widget = await loadInjectionWidgetById(widgetId)
      return widget
    })
  )
  return widgets.filter((w): w is NonNullable<typeof w> => w !== null)
}
