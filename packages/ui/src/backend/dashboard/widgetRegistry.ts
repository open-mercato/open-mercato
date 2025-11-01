import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { dashboardWidgetEntries } from '@/generated/dashboard-widgets.generated'

type Entry = ModuleDashboardWidgetEntry

let entriesPromise: Promise<Entry[]> | null = null

async function getEntries(): Promise<Entry[]> {
  if (!entriesPromise) {
    entriesPromise = Promise.resolve(dashboardWidgetEntries)
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
