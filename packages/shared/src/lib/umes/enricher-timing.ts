import type { EnricherTimingEntry } from './devtools-types'

const MAX_TIMING_ENTRIES = 200
const GLOBAL_KEY = '__openMercatoEnricherTimingEntries__'

const isDev = process.env.NODE_ENV === 'development'

function getStore(): EnricherTimingEntry[] {
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
  if (Array.isArray(existing)) return existing as EnricherTimingEntry[]
  const store: EnricherTimingEntry[] = []
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = store
  return store
}

export function getEnricherTimingEntries(): EnricherTimingEntry[] {
  return getStore()
}

export function clearEnricherTimingEntries(): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = []
}

function addTimingEntry(entry: EnricherTimingEntry): void {
  const store = getStore()
  store.push(entry)
  if (store.length > MAX_TIMING_ENTRIES) {
    const trimmed = store.slice(-MAX_TIMING_ENTRIES)
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = trimmed
  }
}

export function logEnricherTiming(
  enricherId: string,
  moduleId: string,
  targetEntity: string,
  durationMs: number,
): void {
  if (!isDev) return

  addTimingEntry({
    enricherId,
    moduleId,
    targetEntity,
    durationMs,
    timestamp: Date.now(),
  })
}

export async function withEnricherTiming<T>(
  enricherId: string,
  moduleId: string,
  targetEntity: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isDev) return fn()

  const start = performance.now()
  try {
    return await fn()
  } finally {
    const durationMs = Math.round(performance.now() - start)
    logEnricherTiming(enricherId, moduleId, targetEntity, durationMs)
  }
}
