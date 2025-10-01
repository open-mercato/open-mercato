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

export function redirectToForbiddenLogin() {
  if (typeof window === 'undefined') return
  // We don't know required roles from the API response; use a generic hint.
  if (window.location.pathname.startsWith('/login')) return
  try {
    const current = window.location.pathname + window.location.search
    const url = `/login?forbidden=1&redirect=${encodeURIComponent(current)}`
    window.location.href = url
  } catch {
    // no-op
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input as any, init as any)
  if (res.status === 401) {
    // Trigger same redirect flow as protected pages
    redirectToSessionRefresh()
    // Throw a typed error for callers that might still handle it
    throw new UnauthorizedError(await res.text().catch(() => 'Unauthorized'))
  }
  if (res.status === 403) {
    redirectToForbiddenLogin()
    throw new ForbiddenError(await res.text().catch(() => 'Forbidden'))
  }
  return res
}
