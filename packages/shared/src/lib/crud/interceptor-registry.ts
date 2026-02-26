/**
 * API Interceptor Registry
 *
 * Global registry for API interceptors using the same globalThis pattern
 * as injection widgets and response enrichers for HMR-safe storage.
 */

import type { ApiInterceptor, InterceptorRegistryEntry } from './api-interceptor'

const GLOBAL_INTERCEPTORS_KEY = '__openMercatoApiInterceptors__'

let _interceptorEntries: InterceptorRegistryEntry[] | null = null

function readGlobalInterceptors(): InterceptorRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_INTERCEPTORS_KEY]
    return Array.isArray(value) ? (value as InterceptorRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalInterceptors(entries: InterceptorRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_INTERCEPTORS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Check whether a route matches an interceptor's targetRoute pattern.
 *
 * Matching rules:
 * - '*' matches everything
 * - 'example/*' matches 'example/todos', 'example/tags', etc.
 * - 'example/todos' matches exact
 */
function matchesRoute(pattern: string, route: string): boolean {
  if (pattern === '*') return true

  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return route === prefix || route.startsWith(prefix + '/')
  }

  return pattern === route
}

/**
 * Register API interceptors from all modules.
 * Called during bootstrap after generated interceptors are imported.
 */
export function registerApiInterceptors(
  entries: Array<{ moduleId: string; interceptors: ApiInterceptor[] }>,
) {
  const flat: InterceptorRegistryEntry[] = []
  for (const entry of entries) {
    for (const interceptor of entry.interceptors) {
      flat.push({ moduleId: entry.moduleId, interceptor })
    }
  }
  flat.sort((a, b) => (b.interceptor.priority ?? 0) - (a.interceptor.priority ?? 0))

  const priorityMap = new Map<string, string[]>()
  for (const entry of flat) {
    const key = `${entry.interceptor.targetRoute}:${entry.interceptor.priority ?? 0}`
    const existing = priorityMap.get(key)
    if (existing) {
      existing.push(entry.interceptor.id)
      if (existing.length === 2) {
        console.warn(
          `[UMES] API interceptors with same priority (${entry.interceptor.priority ?? 0}) ` +
            `on route "${entry.interceptor.targetRoute}": ${existing.join(', ')}. ` +
            `Execution order is non-deterministic.`,
        )
      }
    } else {
      priorityMap.set(key, [entry.interceptor.id])
    }
  }

  _interceptorEntries = flat
  writeGlobalInterceptors(flat)
}

/**
 * Get all registered API interceptors.
 */
export function getApiInterceptors(): InterceptorRegistryEntry[] {
  const globalEntries = readGlobalInterceptors()
  if (globalEntries) return globalEntries
  if (!_interceptorEntries) {
    return []
  }
  return _interceptorEntries
}

/**
 * Get interceptors matching a specific route and method, sorted by priority (higher first).
 */
export function getInterceptorsForRoute(
  route: string,
  method: string,
): InterceptorRegistryEntry[] {
  const upperMethod = method.toUpperCase()
  return getApiInterceptors().filter((entry) => {
    const interceptor = entry.interceptor
    if (!matchesRoute(interceptor.targetRoute, route)) return false
    if (!interceptor.methods.includes(upperMethod as InterceptorRegistryEntry['interceptor']['methods'][number])) return false
    return true
  })
}
