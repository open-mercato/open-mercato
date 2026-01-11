import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

type Entry = ModuleDashboardWidgetEntry

// Registration pattern for publishable packages
let _dashboardWidgetEntries: Entry[] | null = null

export function registerDashboardWidgets(entries: Entry[]) {
  if (_dashboardWidgetEntries !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Dashboard widgets re-registered (this may occur during HMR)')
  }
  _dashboardWidgetEntries = entries
}

export function getDashboardWidgets(): Entry[] {
  if (!_dashboardWidgetEntries) {
    // On client-side, bootstrap doesn't run - return empty array gracefully
    if (typeof window !== 'undefined') {
      return []
    }
    throw new Error('[Bootstrap] Dashboard widgets not registered. Call registerDashboardWidgets() at bootstrap.')
  }
  return _dashboardWidgetEntries
}

let entriesPromise: Promise<Entry[]> | null = null

async function getEntries(): Promise<Entry[]> {
  if (!entriesPromise) {
    const promise = Promise.resolve().then(() => getDashboardWidgets())
    entriesPromise = promise.catch((err) => {
      // Clear cache on error so next call can retry after registration
      if (entriesPromise === promise) {
        entriesPromise = null
      }
      throw err
    })
  }
  return entriesPromise
}

type LoadedWidgetModule = DashboardWidgetModule<any>

const cache = new Map<string, Promise<LoadedWidgetModule>>()

async function findEntry(loaderKey: string): Promise<Entry | undefined> {
  const entries = await getEntries()
  return entries.find((entry) => entry.key === loaderKey)
}

export async function loadDashboardWidgetModule(loaderKey: string): Promise<LoadedWidgetModule | null> {
  const entry = await findEntry(loaderKey)
  if (!entry) return null
  if (!cache.has(loaderKey)) {
    cache.set(
      loaderKey,
      entry
        .loader()
        .then((mod) => {
          const candidate = mod as LoadedWidgetModule
          const maybeDefault = (mod as { default?: LoadedWidgetModule }).default
          return maybeDefault ?? candidate
        })
    )
  }
  return cache.get(loaderKey) ?? null
}
