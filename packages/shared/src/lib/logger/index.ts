import { selectTransport } from './transport'
import { getLoggerExtension, type LoggerExtensionRecord } from './extension'
import { isLevelEnabled, type LogLevel } from './level'

export type { LogLevel } from './level'
export { getLogLevel, isLevelEnabled, resetLogLevelCache, OM_LOG_LEVEL_ENV } from './level'
export { resetServerLoggerCache, OM_LOG_DESTINATION_ENV } from './transport.server'
export { resetLogPrettyCache, OM_LOG_PRETTY_ENV } from './transport.pretty'
export {
  getLoggerExtension,
  registerLoggerExtension,
  resetLoggerExtension,
} from './extension'
export type { LoggerExtension, LoggerExtensionRecord } from './extension'

export type LogBindings = Record<string, unknown>

export interface Logger {
  debug(msg: string, fields?: LogBindings): void
  info(msg: string, fields?: LogBindings): void
  warn(msg: string, fields?: LogBindings): void
  error(msg: string, fields?: LogBindings): void
  /** Returns a logger with `bindings` merged into every subsequent line. */
  child(bindings: LogBindings): Logger
}

export type LoggerOptions = { write?: (record: LoggerExtensionRecord) => void }

const loggerRegistry = new Map<string, Logger>()

function createExtendedLogger(
  namespace: string,
  transport: Logger,
  bindings: LogBindings = {},
  write?: LoggerOptions['write'],
): Logger {
  const emit = (
    level: LogLevel,
    msg: string,
    fields?: LogBindings,
  ): void => {
    if (!isLevelEnabled(level)) return

    const extension = getLoggerExtension()
    let context: LogBindings = {}
    try {
      context = extension?.enrich?.() ?? {}
    } catch {
      // Observability must never alter application behavior.
    }

    const mergedFields = { ...fields, ...context }
    if (write) {
      try {
        write({ level, namespace, message: msg, fields: { ...bindings, ...mergedFields }, time: Date.now() })
      } catch {
        transport[level](msg, mergedFields)
      }
    } else transport[level](msg, mergedFields)

    try {
      extension?.emit?.({
        level,
        namespace,
        message: msg,
        fields: { ...bindings, ...mergedFields },
        time: Date.now(),
      })
    } catch {
      // Remote logging is best-effort; the local line has already been written.
    }
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (childBindings) =>
      createExtendedLogger(
        namespace,
        transport.child(childBindings),
        { ...bindings, ...childBindings },
        write,
      ),
  }
}

/** Create (or reuse) a namespaced logger. `namespace` is attached as `name`. */
export function createLogger(namespace: string, options?: LoggerOptions): Logger {
  if (options?.write) return createExtendedLogger(namespace, selectTransport(namespace), {}, options.write)
  const existing = loggerRegistry.get(namespace)
  if (existing) return existing
  const created = createExtendedLogger(namespace, selectTransport(namespace))
  loggerRegistry.set(namespace, created)
  return created
}

/** Internal: clear cached loggers so tests can re-run transport selection. */
export function resetLoggerRegistry(): void {
  loggerRegistry.clear()
}
