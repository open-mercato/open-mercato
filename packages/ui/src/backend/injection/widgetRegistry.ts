import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { injectionWidgetEntries } from '@/generated/injection-widgets.generated'

type Entry = ModuleInjectionWidgetEntry

let entriesPromise: Promise<Entry[]> | null = null

async function getEntries(): Promise<Entry[]> {
  if (!entriesPromise) {
    entriesPromise = Promise.resolve(injectionWidgetEntries)
  }
  return entriesPromise
}

type LoadedWidgetModule = InjectionWidgetModule<any, any>

const cache = new Map<string, Promise<LoadedWidgetModule>>()

async function findEntry(loaderKey: string): Promise<Entry | undefined> {
  const entries = await getEntries()
  return entries.find((entry) => entry.key === loaderKey)
}

export async function loadInjectionWidgetModule(loaderKey: string): Promise<LoadedWidgetModule | null> {
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
