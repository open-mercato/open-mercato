export type MfaPendingAccessRoute = {
  path: string
  methods: string[]
}

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
  return Array.from(new Set(normalized)).sort((first, second) => (first < second ? -1 : first > second ? 1 : 0))
}

/**
 * Register routes that may accept an MFA-pending staff token. The registry starts empty and
 * stays generic: every module that completes an MFA challenge on its own endpoints registers
 * them here during its bootstrap — the canonical `/api/security/mfa/*` completion routes are
 * registered by the enterprise `security` module (`lib/mfaCompletionRoutes.ts`), third-party
 * MFA implementations register theirs the same way. Registration is additive: methods merge
 * into any existing entry for the same path and are never removed.
 *
 * Contract defined in `.ai/specs/enterprise/implemented/SPEC-ENT-007-2026-03-06-auth-login-interceptors-extension.md`
 * (§ Amendment 2026-08-21 — central MFA-pending token gate).
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
 * method + path pair. Only explicitly registered completion routes pass; every unregistered
 * request is denied.
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
    .map(([path, methods]) => ({ path, methods: Array.from(methods).sort((first, second) => (first < second ? -1 : first > second ? 1 : 0)) }))
    .sort((first, second) => (first.path < second.path ? -1 : first.path > second.path ? 1 : 0))
}
