import type { LogLevel } from './level'

export type LoggerExtensionRecord = {
  level: LogLevel
  namespace: string
  message: string
  fields: Record<string, unknown>
  time: number
}

export type LoggerExtension = {
  /**
   * Add process-local context (for example trace/span ids) to both the local
   * line and the optional remote sink.
   */
  enrich?(): Record<string, unknown> | undefined
  /**
   * Observe a record after the local transport writes it. Implementations must
   * never throw into application code.
   */
  emit?(record: LoggerExtensionRecord): void
}

const GLOBAL_KEY = Symbol.for('@open-mercato/shared.loggerExtension')

type LoggerExtensionStore = {
  active?: LoggerExtension
}

function store(): LoggerExtensionStore {
  const globalStore = globalThis as unknown as Record<symbol, LoggerExtensionStore | undefined>
  let current = globalStore[GLOBAL_KEY]
  if (!current) {
    current = {}
    globalStore[GLOBAL_KEY] = current
  }
  return current
}

/**
 * Register the single process-wide logger extension. The returned disposer only
 * clears the extension when it is still the active registration.
 */
export function registerLoggerExtension(extension: LoggerExtension): () => void {
  store().active = extension
  return () => {
    const current = store()
    if (current.active === extension) current.active = undefined
  }
}

export function getLoggerExtension(): LoggerExtension | undefined {
  return store().active
}

/** Test-only: clear the process-wide extension. */
export function resetLoggerExtension(): void {
  store().active = undefined
}
