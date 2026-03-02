import type { ApiInterceptor, ApiInterceptorMethod, ApiInterceptorRegistryEntry } from './api-interceptor'

let _interceptorEntries: ApiInterceptorRegistryEntry[] | null = null
const GLOBAL_INTERCEPTOR_KEY = '__openMercatoApiInterceptors__'

function readGlobalInterceptors(): ApiInterceptorRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_INTERCEPTOR_KEY]
    return Array.isArray(value) ? (value as ApiInterceptorRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalInterceptors(entries: ApiInterceptorRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_INTERCEPTOR_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

export function registerApiInterceptors(entries: Array<{ moduleId: string; interceptors: ApiInterceptor[] }>) {
  const flat: ApiInterceptorRegistryEntry[] = []
  entries.forEach((entry, moduleOrder) => {
    entry.interceptors.forEach((interceptor, interceptorOrder) => {
      flat.push({
        moduleId: entry.moduleId,
        interceptor,
        moduleOrder,
        interceptorOrder,
      })
    })
  })
  _interceptorEntries = flat
  writeGlobalInterceptors(flat)
}

export function getAllApiInterceptors(): ApiInterceptorRegistryEntry[] {
  const globalEntries = readGlobalInterceptors()
  if (globalEntries) return globalEntries
  if (!_interceptorEntries) return []
  return _interceptorEntries
}

function routeMatches(targetRoute: string, routePath: string): boolean {
  if (targetRoute === '*') return true
  if (targetRoute.endsWith('/*')) {
    const prefix = targetRoute.slice(0, -2)
    return routePath === prefix || routePath.startsWith(`${prefix}/`)
  }
  return targetRoute === routePath
}

const collisionWarnings = new Set<string>()

export function getApiInterceptorsForRoute(routePath: string, method: ApiInterceptorMethod): ApiInterceptorRegistryEntry[] {
  const matching = getAllApiInterceptors().filter((entry) => {
    const methods = entry.interceptor.methods ?? []
    return methods.includes(method) && routeMatches(entry.interceptor.targetRoute, routePath)
  })

  const sorted = matching.sort((a, b) => {
    const byPriority = (b.interceptor.priority ?? 0) - (a.interceptor.priority ?? 0)
    if (byPriority !== 0) return byPriority
    const byModule = a.moduleOrder - b.moduleOrder
    if (byModule !== 0) return byModule
    return a.interceptorOrder - b.interceptorOrder
  })

  if (process.env.NODE_ENV !== 'production') {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const current = sorted[i]
      const prevPriority = prev.interceptor.priority ?? 0
      const currentPriority = current.interceptor.priority ?? 0
      if (prevPriority !== currentPriority) continue
      const warningKey = `${routePath}:${method}:${prev.interceptor.id}:${current.interceptor.id}:${currentPriority}`
      if (collisionWarnings.has(warningKey)) continue
      collisionWarnings.add(warningKey)
      console.warn(
        `[UMES] Interceptors "${prev.interceptor.id}" and "${current.interceptor.id}" have the same priority (${currentPriority}) for route "${routePath}". Execution order is based on module registration order.`
      )
    }
  }

  return sorted
}
