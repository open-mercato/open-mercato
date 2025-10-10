import { modules } from '@/generated/modules.generated'
import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

type Entry = ModuleDashboardWidgetEntry & { moduleId: string }

const entries: Entry[] = modules.flatMap((mod) => {
  const widgets = mod.dashboardWidgets ?? []
  return widgets.map((entry) => ({ ...entry, moduleId: mod.id }))
})

type LoadedWidgetModule = DashboardWidgetModule<any>

const cache = new Map<string, Promise<LoadedWidgetModule>>()

function findEntry(loaderKey: string): Entry | undefined {
  return entries.find((entry) => entry.key === loaderKey)
}

export async function loadDashboardWidgetModule(loaderKey: string): Promise<LoadedWidgetModule | null> {
  const entry = findEntry(loaderKey)
  if (!entry) return null
  if (!cache.has(loaderKey)) {
    cache.set(loaderKey, entry.loader().then((mod) => (mod.default ?? mod) as LoadedWidgetModule))
  }
  return cache.get(loaderKey) ?? null
}
