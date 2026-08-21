export type MfaPendingAccessRoute = {
  path: string
  methods: string[]
}

const DEFAULT_MFA_PENDING_ACCESS_ROUTES: MfaPendingAccessRoute[] = [
  { path: '/api/security/mfa/prepare', methods: ['POST'] },
  { path: '/api/security/mfa/verify', methods: ['POST'] },
  { path: '/api/security/mfa/recovery', methods: ['POST'] },
]

const registeredMethodsByPath = new Map<string, Set<string>>()

function normalizePath(path: string): string | null {
  if (typeof path !== 'string') return null
  const trimmed = path.trim()
  if (!trimmed || !trimmed.startsWith('/')) return null
  return (trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed).toLowerCase() || '/'
}

function normalizeMethods(methods: unknown): string[] {
  if (!Array.isArray(methods)) return []
  const normalized = methods
    .filter((method): method is string => typeof method === 'string' && method.trim().length > 0)
    .map((method) => method.trim().toUpperCase())
  return Array.from(new Set(normalized)).sort()
}

for (const route of DEFAULT_MFA_PENDING_ACCESS_ROUTES) {
  registeredMethodsByPath.set(normalizePath(route.path) as string, new Set(route.methods))
}

/**
 * Register additional routes that may accept an MFA-pending staff token. Intended for
 * third-party MFA implementations that complete the second factor on their own endpoints.
 * Registration is additive: methods merge into any existing entry for the same path and are
 * never removed.
 */
export function registerMfaPendingAccessRoutes(routes: MfaPendingAccessRoute[]): void {
  for (const route of Array.isArray(routes) ? routes : []) {
    const path = normalizePath(route?.path ?? '')
    const methods = normalizeMethods(route?.methods)
    if (!path || !methods.length) continue
    const existing = registeredMethodsByPath.get(path)
    if (!existing) {
      registeredMethodsByPath.set(path, new Set(methods))
      continue
    }
    for (const method of methods) existing.add(method)
  }
}

/**
 * Fail-closed check deciding whether an MFA-pending staff token may be resolved for this exact
 * method + path pair. Only explicitly registered completion routes (by default the three
 * canonical MFA challenge endpoints) pass; every other request is denied.
 */
export function isMfaPendingAccessAllowed(
  method: string | null | undefined,
  pathname: string | null | undefined,
): boolean {
  const path = normalizePath(typeof pathname === 'string' ? pathname : '')
  if (!path) return false
  if (typeof method !== 'string' || method.trim().length === 0) return false
  const methods = registeredMethodsByPath.get(path)
  if (!methods) return false
  return methods.has(method.trim().toUpperCase())
}

/** Test/ops helper: current snapshot of the pending-access registry. */
export function listMfaPendingAccessRoutes(): ReadonlyArray<Readonly<MfaPendingAccessRoute>> {
  return Array.from(registeredMethodsByPath.entries())
    .map(([path, methods]) => ({ path, methods: Array.from(methods).sort() }))
    .sort((first, second) => first.path.localeCompare(second.path))
}
