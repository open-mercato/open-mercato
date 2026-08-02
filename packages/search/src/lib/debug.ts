/**
 * Debug utilities for search module, backed by the shared structured
 * logging facade (`@open-mercato/shared/lib/logger`).
 *
 * Set OM_SEARCH_DEBUG=true to opt into the verbose diagnostic helpers
 * (`searchDebug`/`searchDebugWarn`). Emission also flows through the
 * global `OM_LOG_LEVEL` gate, so when using OM_SEARCH_DEBUG in
 * production set OM_LOG_LEVEL=debug as well.
 */

import { createLogger, type Logger } from '@open-mercato/shared/lib/logger'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const packageLogger = createLogger('search')
const componentLoggers = new Map<string, Logger>()

function componentLogger(prefix: string): Logger {
  const existing = componentLoggers.get(prefix)
  if (existing) return existing
  const scoped = packageLogger.child({ component: prefix })
  componentLoggers.set(prefix, scoped)
  return scoped
}

export function isSearchDebugEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_SEARCH_DEBUG, false)
}

/**
 * Log a debug message if OM_SEARCH_DEBUG is enabled.
 */
export function searchDebug(prefix: string, message: string, data?: Record<string, unknown>): void {
  if (!isSearchDebugEnabled()) return
  componentLogger(prefix).debug(message, data)
}

/**
 * Log a warning message if OM_SEARCH_DEBUG is enabled.
 */
export function searchDebugWarn(prefix: string, message: string, data?: Record<string, unknown>): void {
  if (!isSearchDebugEnabled()) return
  componentLogger(prefix).warn(message, data)
}

/**
 * Log a warning message (always logs, not gated by debug flag).
 * Use for operational warnings that must stay visible without OM_SEARCH_DEBUG,
 * such as skipping a vector-index run because the provider is unreachable or
 * the configured embedding dimension no longer matches the vector table.
 */
export function searchWarn(prefix: string, message: string, data?: Record<string, unknown>): void {
  componentLogger(prefix).warn(message, data)
}

/**
 * Log an error message (always logs, not gated by debug flag).
 * Errors should always be visible for troubleshooting.
 */
export function searchError(prefix: string, message: string, data?: Record<string, unknown>): void {
  componentLogger(prefix).error(message, data)
}
