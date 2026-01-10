import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'

type Entry = ModuleInjectionWidgetEntry

// Registration pattern for publishable packages
let _injectionWidgetEntries: Entry[] | null = null

export function registerInjectionWidgets(entries: Entry[]) {
  if (_injectionWidgetEntries !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Injection widgets re-registered (this may occur during HMR)')
  }
  _injectionWidgetEntries = entries
}

export function getInjectionWidgets(): Entry[] {
  if (!_injectionWidgetEntries) {
    // On client-side, bootstrap doesn't run - return empty array gracefully
    if (typeof window !== 'undefined') {
      return []
    }
    throw new Error('[Bootstrap] Injection widgets not registered. Call registerInjectionWidgets() at bootstrap.')
  }
  return _injectionWidgetEntries
}

let entriesPromise: Promise<Entry[]> | null = null

async function getEntries(): Promise<Entry[]> {
  if (!entriesPromise) {
    const promise = Promise.resolve().then(() => getInjectionWidgets())
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
