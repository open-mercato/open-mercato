import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { applyDashboardWidgetOverridesToEntries } from '@open-mercato/shared/modules/overrides'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui')

type Entry = ModuleDashboardWidgetEntry
type LoadedWidgetModule = DashboardWidgetModule<any>

const cache = new Map<string, Promise<LoadedWidgetModule>>()

// Registration pattern for publishable packages
let _dashboardWidgetEntries: Entry[] | null = null
let registrationWaiters: Array<(entries: Entry[]) => void> = []

function resolveRegistrationWaiters(entries: Entry[]) {
  const waiters = registrationWaiters
  registrationWaiters = []
  for (const resolve of waiters) {
    resolve(entries)
  }
}

export function registerDashboardWidgets(entries: Entry[]) {
  if (_dashboardWidgetEntries !== null && process.env.NODE_ENV === 'development') {
    logger.debug('Dashboard widgets re-registered (this may occur during HMR)')
  }
  _dashboardWidgetEntries = applyDashboardWidgetOverridesToEntries(entries)
  entriesPromise = Promise.resolve(_dashboardWidgetEntries)
  cache.clear()
  resolveRegistrationWaiters(_dashboardWidgetEntries)
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
  if (_dashboardWidgetEntries) {
    return _dashboardWidgetEntries
  }
  if (!entriesPromise) {
    const promise = typeof window !== 'undefined'
      ? new Promise<Entry[]>((resolve) => {
        registrationWaiters.push(resolve)
      })
      : Promise.resolve().then(() => getDashboardWidgets())
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
