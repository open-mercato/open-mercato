// Simple fetch wrapper that redirects to session refresh on 401 (Unauthorized)
// Used across UI data utilities to avoid duplication.
export class UnauthorizedError extends Error {
  readonly status = 401
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export function redirectToSessionRefresh() {
  if (typeof window === 'undefined') return
  const current = window.location.pathname + window.location.search
  // Avoid redirect loops if already on an auth/session route
  if (window.location.pathname.startsWith('/api/auth')) return
  try {
    window.location.href = `/api/auth/session/refresh?redirect=${encodeURIComponent(current)}`
  } catch {
    // no-op
  }
}

export class ForbiddenError extends Error {
  readonly status = 403
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

let authRedirectConfig = { defaultForbiddenRoles: ['admin'] as string[] }

export function setAuthRedirectConfig(cfg: Partial<typeof authRedirectConfig>) {
  authRedirectConfig = { ...authRedirectConfig, ...cfg }
}

export function redirectToForbiddenLogin(requiredRoles?: string[] | null) {
  if (typeof window === 'undefined') return
  // We don't know required roles from the API response; use a generic hint.
  if (window.location.pathname.startsWith('/login')) return
  try {
    const current = window.location.pathname + window.location.search
    const roles = (requiredRoles && requiredRoles.length ? requiredRoles : authRedirectConfig.defaultForbiddenRoles)
    const url = `/login?requireRole=${encodeURIComponent(roles.join(','))}&redirect=${encodeURIComponent(current)}`
    window.location.href = url
  } catch {
    // no-op
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const baseFetch: typeof fetch = (typeof window !== 'undefined' && (window as any).__omOriginalFetch)
    ? (window as any).__omOriginalFetch
    : fetch
  const res = await baseFetch(input as any, init as any)
  if (res.status === 401) {
    // Trigger same redirect flow as protected pages
    redirectToSessionRefresh()
    // Throw a typed error for callers that might still handle it
    throw new UnauthorizedError(await res.text().catch(() => 'Unauthorized'))
  }
  if (res.status === 403) {
    // Try to read requiredRoles from JSON body; ignore if not JSON
    let roles: string[] | null = null
    try {
      const clone = res.clone()
      const data = await clone.json()
      if (Array.isArray(data?.requiredRoles)) roles = data.requiredRoles.map((r: any) => String(r))
    } catch {}
    redirectToForbiddenLogin(roles)
    const msg = await res.text().catch(() => 'Forbidden')
    throw new ForbiddenError(msg)
  }
  return res
}
