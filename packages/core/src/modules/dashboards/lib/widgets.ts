import type { Module, ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { DashboardWidgetMetadata, DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { applyDashboardWidgetOverridesToEntries } from '@open-mercato/shared/modules/overrides'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { onModulesRegistered } from '@open-mercato/shared/lib/modules/registry'

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

// Close the boot race at its source (#5103). Bootstrap can register modules more
// than once — an i18n-only registration is later reconciled with the full module
// list — and a resolution computed in between describes a registry that no longer
// exists. The registry notifies only when the registered set actually changed, so
// a healthy boot costs nothing and no work is added to the request path.
onModulesRegistered(() => {
  invalidateWidgetCache()
})

/**
 * An empty resolution means the module registry was not populated yet — a boot
 * race, not "this app has no dashboard widgets". Memoizing it would serve an
 * empty registry for the lifetime of the process, so the entry is dropped and
 * the next call retries. A rejected resolution is dropped for the same reason.
 */
async function loadWidgetEntries(): Promise<WidgetEntry[]> {
  if (!widgetEntriesPromise) {
    const pending = Promise.resolve().then(() => {
      const list = getModules() as Module[]
      const entries = list.flatMap((mod) => {
        const moduleEntries = mod.dashboardWidgets ?? []
        return moduleEntries.map((entry) => ({
          ...entry,
          moduleId: mod.id,
        }))
      })
      return applyDashboardWidgetOverridesToEntries(entries) as WidgetEntry[]
    })
    widgetEntriesPromise = pending
    const forgetWhenUnusable = (entries: WidgetEntry[] | null) => {
      if (widgetEntriesPromise === pending && (entries === null || entries.length === 0)) {
        widgetEntriesPromise = null
      }
    }
    try {
      const entries = await pending
      forgetWhenUnusable(entries)
      return entries
    } catch (err) {
      forgetWhenUnusable(null)
      throw err
    }
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
    // Same policy as the entries cache above: a rejected resolution is a transient
    // failure (a dynamic import that lost a race), not a permanent fact about the
    // widget. Memoizing it would make loadAllWidgets() reject for the lifetime of the
    // process. The identity check mirrors `widgetEntriesPromise === pending`, so a
    // concurrent invalidateWidgetCache() is never clobbered.
    promise.catch(() => {
      if (widgetCache.get(entry.key) === promise) widgetCache.delete(entry.key)
    })
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
