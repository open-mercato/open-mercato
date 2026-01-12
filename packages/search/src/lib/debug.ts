/**
 * Debug utilities for search module.
 *
 * Set OM_SEARCH_DEBUG=true to enable debug logging.
 */

export function isSearchDebugEnabled(): boolean {
  const raw = (process.env.OM_SEARCH_DEBUG ?? '').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/**
 * Log a debug message if OM_SEARCH_DEBUG is enabled.
 */
export function searchDebug(prefix: string, message: string, data?: Record<string, unknown>): void {
  if (!isSearchDebugEnabled()) return
  if (data) {
    console.log(`[${prefix}] ${message}`, data)
  } else {
    console.log(`[${prefix}] ${message}`)
  }
}

/**
 * Log a warning message if OM_SEARCH_DEBUG is enabled.
 */
export function searchDebugWarn(prefix: string, message: string, data?: Record<string, unknown>): void {
  if (!isSearchDebugEnabled()) return
  if (data) {
    console.warn(`[${prefix}] ${message}`, data)
  } else {
    console.warn(`[${prefix}] ${message}`)
  }
}

/**
 * Log an error message (always logs, not gated by debug flag).
 * Errors should always be visible for troubleshooting.
 */
export function searchError(prefix: string, message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.error(`[${prefix}] ${message}`, data)
  } else {
    console.error(`[${prefix}] ${message}`)
  }
}
