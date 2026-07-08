import { selectTransport } from './transport'

export type { LogLevel } from './level'
export { getLogLevel, isLevelEnabled, resetLogLevelCache, OM_LOG_LEVEL_ENV } from './level'
export { resetServerLoggerCache, OM_LOG_DESTINATION_ENV } from './transport.server'

export type LogBindings = Record<string, unknown>

export interface Logger {
  debug(msg: string, fields?: LogBindings): void
  info(msg: string, fields?: LogBindings): void
  warn(msg: string, fields?: LogBindings): void
  error(msg: string, fields?: LogBindings): void
  /** Returns a logger with `bindings` merged into every subsequent line. */
  child(bindings: LogBindings): Logger
}

const loggerRegistry = new Map<string, Logger>()

/** Create (or reuse) a namespaced logger. `namespace` is attached as `name`. */
export function createLogger(namespace: string): Logger {
  const existing = loggerRegistry.get(namespace)
  if (existing) return existing
  const created = selectTransport(namespace)
  loggerRegistry.set(namespace, created)
  return created
}

/** Internal: clear cached loggers so tests can re-run transport selection. */
export function resetLoggerRegistry(): void {
  loggerRegistry.clear()
}
