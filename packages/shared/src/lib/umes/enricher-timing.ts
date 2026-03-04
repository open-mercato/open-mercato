import type { EnricherTimingEntry } from './devtools-types'

const TIMING_WARN_THRESHOLD_MS = 100
const TIMING_ERROR_THRESHOLD_MS = 500
const MAX_TIMING_ENTRIES = 200

const isDev = process.env.NODE_ENV === 'development'

let timingEntries: EnricherTimingEntry[] = []

export function getEnricherTimingEntries(): EnricherTimingEntry[] {
  return timingEntries
}

export function clearEnricherTimingEntries(): void {
  timingEntries = []
}

function addTimingEntry(entry: EnricherTimingEntry): void {
  timingEntries.push(entry)
  if (timingEntries.length > MAX_TIMING_ENTRIES) {
    timingEntries = timingEntries.slice(-MAX_TIMING_ENTRIES)
  }
}

export function logEnricherTiming(
  enricherId: string,
  moduleId: string,
  targetEntity: string,
  durationMs: number,
): void {
  if (!isDev) return

  const entry: EnricherTimingEntry = {
    enricherId,
    moduleId,
    targetEntity,
    durationMs,
    timestamp: Date.now(),
  }

  addTimingEntry(entry)

  if (durationMs >= TIMING_ERROR_THRESHOLD_MS) {
    console.error(
      `[UMES] Enricher "${enricherId}" took ${durationMs}ms (>500ms). Consider adding cache config.`,
    )
  } else if (durationMs >= TIMING_WARN_THRESHOLD_MS) {
    console.warn(
      `[UMES] Enricher "${enricherId}" took ${durationMs}ms (warning: >100ms)`,
    )
  }
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
