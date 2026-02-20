import type { ModuleInjectionWidgetEntry } from '../registry'
import type {
  InjectionWidgetMetadata,
  InjectionWidgetModule,
  InjectionSpotId,
  ModuleInjectionSlot,
  ModuleInjectionTable,
  InjectionWidgetPlacement,
} from './injection'

type LoadedWidgetModule = InjectionWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }
export type LoadedInjectionWidget = LoadedWidgetModule & {
  moduleId: string
  key: string
  placement?: {
    groupId?: string
    groupLabel?: string
    groupDescription?: string
    column?: 1 | 2
    kind?: 'tab' | 'group' | 'stack'
    [k: string]: unknown
  }
}

type WidgetEntry = ModuleInjectionWidgetEntry & { moduleId: string }

// Registration pattern for publishable packages
let _coreInjectionWidgetEntries: ModuleInjectionWidgetEntry[] | null = null
let _coreInjectionTables: Array<{ moduleId: string; table: ModuleInjectionTable }> | null = null

export function registerCoreInjectionWidgets(entries: ModuleInjectionWidgetEntry[]) {
  if (_coreInjectionWidgetEntries !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Core injection widgets re-registered (this may occur during HMR)')
  }
  _coreInjectionWidgetEntries = entries
}

export function getCoreInjectionWidgets(): ModuleInjectionWidgetEntry[] {
  if (!_coreInjectionWidgetEntries) {
    // On client-side, bootstrap doesn't run - return empty array gracefully
    if (typeof window !== 'undefined') {
      return []
    }
    throw new Error('[Bootstrap] Core injection widgets not registered. Call registerCoreInjectionWidgets() at bootstrap.')
  }
  return _coreInjectionWidgetEntries
}

export function registerCoreInjectionTables(tables: Array<{ moduleId: string; table: ModuleInjectionTable }>) {
  if (_coreInjectionTables !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Core injection tables re-registered (this may occur during HMR)')
  }
  _coreInjectionTables = tables
}

export function getCoreInjectionTables(): Array<{ moduleId: string; table: ModuleInjectionTable }> {
  if (!_coreInjectionTables) {
    // On client-side, bootstrap doesn't run - return empty array gracefully
    if (typeof window !== 'undefined') {
      return []
    }
    throw new Error('[Bootstrap] Core injection tables not registered. Call registerCoreInjectionTables() at bootstrap.')
  }
  return _coreInjectionTables
}

let widgetEntriesPromise: Promise<WidgetEntry[]> | null = null
type TableEntry = {
  widgetId: string
  moduleId: string
  priority: number
  placement?: ModuleInjectionSlot extends infer S
    ? S extends { widgetId: string }
      ? Omit<S, 'widgetId' | 'priority'>
      : never
    : never
}
let injectionTablePromise: Promise<Map<InjectionSpotId, TableEntry[]>> | null = null

function isInjectionSlotObject(value: ModuleInjectionSlot): value is InjectionWidgetPlacement & { widgetId: string; priority?: number } {
  return typeof value === 'object' && value !== null && 'widgetId' in value
}

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
    const promise = Promise.resolve().then(() =>
      getCoreInjectionWidgets().map((entry) => ({
        ...entry,
        moduleId: entry.moduleId || 'unknown',
      }))
    )
    widgetEntriesPromise = promise.catch((err) => {
      // Clear cache on error so next call can retry after registration
      if (widgetEntriesPromise === promise) {
        widgetEntriesPromise = null
      }
      throw err
    })
  }
  return widgetEntriesPromise
}

async function loadInjectionTable(): Promise<Map<InjectionSpotId, TableEntry[]>> {
  if (!injectionTablePromise) {
    const promise = Promise.resolve().then(() => {
      const list = getCoreInjectionTables()
      const table = new Map<InjectionSpotId, TableEntry[]>()

      for (const entry of list) {
        const injectionTable = entry.table ?? {}
        for (const [spotId, widgetIds] of Object.entries(injectionTable)) {
          const widgets = Array.isArray(widgetIds) ? widgetIds : [widgetIds]
          const existing = table.get(spotId) ?? []
          for (const widgetEntry of widgets) {
            if (typeof widgetEntry === 'string') {
              existing.push({ widgetId: widgetEntry, moduleId: entry.moduleId, priority: 0 })
              continue
            }
            if (isInjectionSlotObject(widgetEntry)) {
              const { widgetId, priority = 0, ...placement } = widgetEntry
              existing.push({
                widgetId,
                moduleId: entry.moduleId,
                priority: typeof priority === 'number' ? priority : 0,
                placement,
              })
              continue
            }
          }
          table.set(spotId, existing)
        }
      }

      for (const [spotId, widgets] of table.entries()) {
        table.set(spotId, widgets.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)))
      }

      return table
    })
    injectionTablePromise = promise.catch((err) => {
      // Clear cache on error so next call can retry after registration
      if (injectionTablePromise === promise) {
        injectionTablePromise = null
      }
      throw err
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

export async function loadAllInjectionWidgets(): Promise<LoadedInjectionWidget[]> {
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

export async function loadInjectionWidgetById(widgetId: string): Promise<LoadedInjectionWidget | null> {
  const widgetEntries = await loadWidgetEntries()
  for (const entry of widgetEntries) {
    const widget = await loadEntry(entry)
    if (widget.metadata.id === widgetId) {
      return { ...widget, moduleId: entry.moduleId, key: entry.key }
    }
  }
  return null
}

export async function loadInjectionWidgetsForSpot(spotId: InjectionSpotId): Promise<LoadedInjectionWidget[]> {
  const table = await loadInjectionTable()
  const exactEntries = table.get(spotId) ?? []
  const wildcardEntries: TableEntry[] = []
  for (const [candidateSpotId, candidateEntries] of table.entries()) {
    if (candidateSpotId === spotId) continue
    if (!candidateSpotId.includes('*')) continue
    const pattern = new RegExp(`^${candidateSpotId.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    if (!pattern.test(spotId)) continue
    wildcardEntries.push(...candidateEntries)
  }
  const dedupedEntries = new Map<string, TableEntry>()
  for (const entry of [...exactEntries, ...wildcardEntries]) {
    const key = `${entry.moduleId}:${entry.widgetId}`
    const previous = dedupedEntries.get(key)
    if (!previous || (entry.priority ?? 0) > (previous.priority ?? 0)) {
      dedupedEntries.set(key, entry)
    }
  }
  const entries = Array.from(dedupedEntries.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  const widgets = await Promise.all(
    entries.map(async ({ widgetId, placement, priority }) => {
      const widget = await loadInjectionWidgetById(widgetId)
      const combinedPlacement = placement
        ? { ...placement, priority: typeof priority === 'number' ? priority : 0 }
        : { priority: typeof priority === 'number' ? priority : 0 }
      return widget ? { ...widget, placement: combinedPlacement } : null
    })
  )
  return widgets.filter((w): w is NonNullable<typeof w> => w !== null)
}
