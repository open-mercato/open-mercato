import type { ModuleInjectionWidgetEntry } from '../registry'
import type {
  InjectionAnyWidgetModule,
  InjectionDataWidgetModule,
  InjectionWidgetMetadata,
  InjectionWidgetModule,
  InjectionSpotId,
  ModuleInjectionSlot,
  ModuleInjectionTable,
  InjectionWidgetPlacement,
} from './injection'

type LoadedWidgetModule = InjectionWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }
type LoadedDataWidgetModule = InjectionDataWidgetModule & { metadata: InjectionWidgetMetadata }

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

export type LoadedInjectionDataWidget = LoadedDataWidgetModule & {
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
const GLOBAL_INJECTION_WIDGETS_KEY = '__openMercatoCoreInjectionWidgetEntries__'
const GLOBAL_INJECTION_TABLES_KEY = '__openMercatoCoreInjectionTables__'

function readGlobalInjectionWidgets(): ModuleInjectionWidgetEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_INJECTION_WIDGETS_KEY]
    return Array.isArray(value) ? (value as ModuleInjectionWidgetEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalInjectionWidgets(entries: ModuleInjectionWidgetEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_INJECTION_WIDGETS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

function readGlobalInjectionTables(): Array<{ moduleId: string; table: ModuleInjectionTable }> | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_INJECTION_TABLES_KEY]
    return Array.isArray(value) ? (value as Array<{ moduleId: string; table: ModuleInjectionTable }>) : null
  } catch {
    return null
  }
}

function writeGlobalInjectionTables(tables: Array<{ moduleId: string; table: ModuleInjectionTable }>) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_INJECTION_TABLES_KEY] = tables
  } catch {
    // ignore global assignment failures
  }
}

export function registerCoreInjectionWidgets(entries: ModuleInjectionWidgetEntry[]) {
  if (_coreInjectionWidgetEntries !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Core injection widgets re-registered (this may occur during HMR)')
  }
  _coreInjectionWidgetEntries = entries
  writeGlobalInjectionWidgets(entries)
}

export function getCoreInjectionWidgets(): ModuleInjectionWidgetEntry[] {
  const globalEntries = readGlobalInjectionWidgets()
  if (globalEntries) return globalEntries
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
  writeGlobalInjectionTables(tables)
}

export function getCoreInjectionTables(): Array<{ moduleId: string; table: ModuleInjectionTable }> {
  const globalTables = readGlobalInjectionTables()
  if (globalTables) return globalTables
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
      if (injectionTablePromise === promise) {
        injectionTablePromise = null
      }
      throw err
    })
  }
  return injectionTablePromise
}

const widgetCache = new Map<string, Promise<InjectionAnyWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }>>()

function isDataWidgetModule(widget: Record<string, unknown>): widget is LoadedDataWidgetModule {
  const keys = [
    'columns',
    'rowActions',
    'bulkActions',
    'filters',
    'fields',
    'steps',
    'badge',
    'menuItems',
  ]
  return keys.some((key) => key in widget)
}

function ensureValidInjectionModule(mod: unknown, key: string, moduleId: string): (InjectionAnyWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }) {
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Invalid injection widget module "${key}" from "${moduleId}" (expected object export)`)
  }
  const widget = (mod as { default?: InjectionAnyWidgetModule<any, any> }).default ?? (mod as InjectionAnyWidgetModule<any, any>)
  if (!widget || typeof widget !== 'object') {
    throw new Error(`Invalid injection widget export "${key}" from "${moduleId}" (missing default export)`) 
  }
  if (!('metadata' in widget) || !widget.metadata || typeof widget.metadata !== 'object') {
    throw new Error(`Injection widget "${key}" from "${moduleId}" is missing metadata`)
  }
  const metadata = widget.metadata
  if (typeof metadata.id !== 'string' || metadata.id.length === 0) {
    throw new Error(`Injection widget "${key}" from "${moduleId}" metadata.id must be a non-empty string`)
  }
  const normalized = {
    ...widget,
    metadata,
  }

  if ('Widget' in normalized && typeof normalized.Widget === 'function') {
    if (typeof metadata.title !== 'string' || metadata.title.length === 0) {
      throw new Error(`Injection widget "${metadata.id}" from "${moduleId}" must have a title`)
    }
    return normalized
  }

  if (!isDataWidgetModule(normalized as Record<string, unknown>)) {
    throw new Error(
      `Injection widget "${metadata.id}" from "${moduleId}" must export either Widget component or a declarative data payload`
    )
  }

  return normalized
}

function isLoadedInjectionWidget(
  module: InjectionAnyWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }
): module is LoadedWidgetModule {
  return 'Widget' in module && typeof module.Widget === 'function'
}

function isLoadedInjectionDataWidget(
  module: InjectionAnyWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }
): module is LoadedDataWidgetModule {
  return !isLoadedInjectionWidget(module)
}

async function loadEntry(entry: WidgetEntry): Promise<InjectionAnyWidgetModule<any, any> & { metadata: InjectionWidgetMetadata }> {
  if (!widgetCache.has(entry.key)) {
    const promise = entry.loader().then((mod) => ensureValidInjectionModule(mod, entry.key, entry.moduleId))
    widgetCache.set(entry.key, promise)
  }
  return widgetCache.get(entry.key)!
}

async function getResolvedEntriesForSpot(spotId: InjectionSpotId): Promise<TableEntry[]> {
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
    const cacheKey = `${entry.moduleId}:${entry.widgetId}`
    const previous = dedupedEntries.get(cacheKey)
    if (!previous || (entry.priority ?? 0) > (previous.priority ?? 0)) {
      dedupedEntries.set(cacheKey, entry)
    }
  }

  return Array.from(dedupedEntries.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}

export async function loadAllInjectionWidgets(): Promise<LoadedInjectionWidget[]> {
  const widgetEntries = await loadWidgetEntries()
  const loaded = await Promise.all(
    widgetEntries.map(async (entry) => {
      const module = await loadEntry(entry)
      if (!isLoadedInjectionWidget(module)) return null
      return { ...module, moduleId: entry.moduleId, key: entry.key }
    })
  )
  const byId = new Map<string, LoadedInjectionWidget>()
  for (const widget of loaded) {
    if (!widget) continue
    if (!byId.has(widget.metadata.id)) {
      byId.set(widget.metadata.id, widget)
    }
  }
  return Array.from(byId.values())
}

export async function loadInjectionWidgetById(widgetId: string): Promise<LoadedInjectionWidget | null> {
  const widgetEntries = await loadWidgetEntries()
  for (const entry of widgetEntries) {
    const module = await loadEntry(entry)
    if (!isLoadedInjectionWidget(module)) continue
    if (module.metadata.id === widgetId) {
      return { ...module, moduleId: entry.moduleId, key: entry.key }
    }
  }
  return null
}

export async function loadInjectionDataWidgetById(widgetId: string): Promise<LoadedInjectionDataWidget | null> {
  const widgetEntries = await loadWidgetEntries()
  for (const entry of widgetEntries) {
    const module = await loadEntry(entry)
    if (!isLoadedInjectionDataWidget(module)) continue
    if (module.metadata.id === widgetId) {
      return { ...module, moduleId: entry.moduleId, key: entry.key }
    }
  }
  return null
}

export async function loadInjectionWidgetsForSpot(spotId: InjectionSpotId): Promise<LoadedInjectionWidget[]> {
  const entries = await getResolvedEntriesForSpot(spotId)
  const widgets: LoadedInjectionWidget[] = []
  for (const { widgetId, placement, priority } of entries) {
    const widget = await loadInjectionWidgetById(widgetId)
    if (!widget) continue
    const combinedPlacement = placement
      ? { ...placement, priority: typeof priority === 'number' ? priority : 0 }
      : { priority: typeof priority === 'number' ? priority : 0 }
    widgets.push({ ...widget, placement: combinedPlacement })
  }
  return widgets
}

export async function loadInjectionDataWidgetsForSpot(spotId: InjectionSpotId): Promise<LoadedInjectionDataWidget[]> {
  const entries = await getResolvedEntriesForSpot(spotId)
  const widgets: LoadedInjectionDataWidget[] = []
  for (const { widgetId, placement, priority } of entries) {
    const widget = await loadInjectionDataWidgetById(widgetId)
    if (!widget) continue
    const combinedPlacement = placement
      ? { ...placement, priority: typeof priority === 'number' ? priority : 0 }
      : { priority: typeof priority === 'number' ? priority : 0 }
    widgets.push({ ...widget, placement: combinedPlacement })
  }
  return widgets
}
