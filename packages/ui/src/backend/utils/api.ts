// Simple fetch wrapper that redirects to session refresh on 401 (Unauthorized)
// Used across UI data utilities to avoid duplication.
import { flash } from '../FlashMessages'
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
    flash('Session expired. Redirecting to sign in…', 'warning')
    setTimeout(() => {
      window.location.href = `/api/auth/session/refresh?redirect=${encodeURIComponent(current)}`
    }, 20)
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

const DEFAULT_FORBIDDEN_ROLES = ['admin'] as const;

// Remove setAuthRedirectConfig and mutable config.

export function redirectToForbiddenLogin(
  requiredRoles?: string[] | null,
  config?: { defaultForbiddenRoles?: readonly string[] }
) {
  if (typeof window === 'undefined') return
  // We don't know required roles from the API response; use a generic hint.
  if (window.location.pathname.startsWith('/login')) return
  try {
    const current = window.location.pathname + window.location.search
    const roles =
      requiredRoles && requiredRoles.length
        ? requiredRoles
        : (config?.defaultForbiddenRoles ?? DEFAULT_FORBIDDEN_ROLES)
    const url = `/login?requireRole=${encodeURIComponent(roles.join(','))}&redirect=${encodeURIComponent(current)}`
    flash('Insufficient permissions. Redirecting to login…', 'warning')
    setTimeout(() => { window.location.href = url }, 60)
  } catch {
    // no-op
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  type FetchType = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  const baseFetch: FetchType = (typeof window !== 'undefined' && (window as any).__omOriginalFetch)
    ? ((window as any).__omOriginalFetch as FetchType)
    : fetch;
  const res = await baseFetch(input, init);
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
