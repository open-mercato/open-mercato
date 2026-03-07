import type { InterceptorActivityEntry } from './devtools-types'

const MAX_ACTIVITY_ENTRIES = 200
const GLOBAL_KEY = '__openMercatoInterceptorActivityEntries__'

const isDev = process.env.NODE_ENV === 'development'

function getStore(): InterceptorActivityEntry[] {
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
  if (Array.isArray(existing)) return existing as InterceptorActivityEntry[]
  const store: InterceptorActivityEntry[] = []
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = store
  return store
}

export function getInterceptorActivityEntries(): InterceptorActivityEntry[] {
  return getStore()
}

export function clearInterceptorActivityEntries(): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = []
}

export function logInterceptorActivity(entry: InterceptorActivityEntry): void {
  if (!isDev) return

  const store = getStore()
  store.push(entry)
  if (store.length > MAX_ACTIVITY_ENTRIES) {
    const trimmed = store.slice(-MAX_ACTIVITY_ENTRIES)
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = trimmed
  }
}
