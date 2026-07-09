"use client"
// Simple fetch wrapper that redirects to session refresh on 401 (Unauthorized)
// Used across UI data utilities to avoid duplication.
import { flash } from '../FlashMessages'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { pushOperation } from '../operations/store'
import { pushPartialIndexWarning } from '../indexes/store'
import { createScopedHeaderStack } from './scopedHeaderStack'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'apiFetch' })

const scopedHeaders = createScopedHeaderStack()

function mergeHeaders(base: HeadersInit | undefined, scoped: Record<string, string>): Headers {
  const headers = new Headers(base ?? {})
  for (const [key, value] of Object.entries(scoped)) {
    if (headers.has(key)) continue
    headers.set(key, value)
  }
  return headers
}

function readRedirectOverride(headers: Headers, headerName: string): boolean {
  return headers.get(headerName) === '0'
}

function isSameOriginRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location?.host
  if (!host) return false
  let urlString: string
  if (typeof input === 'string') urlString = input
  else if (input instanceof URL) urlString = input.toString()
  else if (typeof Request !== 'undefined' && input instanceof Request) urlString = input.url
  else return false
  if (!/^[a-z][a-z0-9+.-]*:/i.test(urlString)) return true
  try {
    return new URL(urlString).host === host
  } catch {
    return false
  }
}

export async function withScopedApiHeaders<T>(headers: Record<string, string>, run: () => Promise<T>): Promise<T> {
  return scopedHeaders.withScopedHeaders(headers, run)
}

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
  // Portal routes have their own customer auth — never redirect to staff login
  if (/\/[^/]+\/portal(\/|$)/.test(window.location.pathname)) return
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

let DEFAULT_FORBIDDEN_ROLES: string[] = ['admin']

export function setAuthRedirectConfig(cfg: { defaultForbiddenRoles?: readonly string[] }) {
  if (cfg?.defaultForbiddenRoles && cfg.defaultForbiddenRoles.length) {
    DEFAULT_FORBIDDEN_ROLES = [...cfg.defaultForbiddenRoles].map(String)
  }
}

function formatForbiddenAccessMessage(options?: { requiredRoles?: string[] | null; requiredFeatures?: string[] | null }): string {
  const features = options?.requiredFeatures?.filter(Boolean) ?? []
  const roles = options?.requiredRoles?.filter(Boolean) ?? []
  const effectiveRoles = roles.length ? roles : DEFAULT_FORBIDDEN_ROLES.filter(Boolean)
  if (features.length) {
    return `Access denied: you are missing the required permission "${features.join(', ')}". Contact your administrator.`
  }
  if (effectiveRoles.length) {
    return `Access denied: this area requires the role "${effectiveRoles.join(', ')}". Contact your administrator.`
  }
  return 'Access denied: you do not have permission to perform this action.'
}

/**
 * Signal a forbidden access attempt for an authenticated user via a flash banner.
 *
 * Authenticated 403 responses must never redirect to `/login` — that creates an
 * infinite loop because the login page detects the active session and bounces
 * the user back to the failing destination (see GH #2070). Pages that need an
 * inline banner should catch `ForbiddenError` and render `AccessDeniedMessage`
 * from `@open-mercato/ui/backend/detail`.
 */
export function notifyForbiddenAccess(options?: { requiredRoles?: string[] | null; requiredFeatures?: string[] | null }) {
  if (typeof window === 'undefined') return
  // Portal routes have their own customer auth — keep the existing no-op contract.
  if (/\/[^/]+\/portal(\/|$)/.test(window.location.pathname)) return
  try {
    flash(formatForbiddenAccessMessage(options), 'warning')
  } catch {
    // no-op
  }
}

/**
 * @deprecated Renamed to {@link notifyForbiddenAccess}. The previous name
 * implied a `/login` redirect that no longer happens (see GH #2070). Kept as an
 * exported alias for one minor version so third-party module imports keep
 * building; update imports to `notifyForbiddenAccess`.
 */
export const redirectToForbiddenLogin = notifyForbiddenAccess

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  type FetchType = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  const originalFetch =
    typeof window !== 'undefined'
      ? (window as Window & { __omOriginalFetch?: FetchType }).__omOriginalFetch
      : undefined
  const fallbackFetch = (globalThis as typeof globalThis & { fetch?: FetchType }).fetch
  const baseFetch = originalFetch ?? fallbackFetch
  if (!baseFetch) {
    return new Response(
      JSON.stringify({ error: 'Fetch API is not available in this runtime' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )
  }
  const scoped = scopedHeaders.resolveScopedHeaders()
  const baseInit: RequestInit = Object.keys(scoped).length
    ? { ...(init ?? {}), headers: mergeHeaders(init?.headers, scoped) }
    : init ?? {}
  // Only auto-inject credentials: 'include' for same-origin requests so cookies
  // round-trip across Next.js proxy.ts rewrites (custom-domain portal flows)
  // without leaking session cookies to third-party hosts.
  const mergedInit: RequestInit = baseInit.credentials
    ? baseInit
    : isSameOriginRequest(input)
      ? { ...baseInit, credentials: 'include' }
      : baseInit
  const requestHeaders = new Headers(mergedInit?.headers)
  const disableUnauthorizedRedirect = readRedirectOverride(requestHeaders, 'x-om-unauthorized-redirect')
  const disableForbiddenRedirect = readRedirectOverride(requestHeaders, 'x-om-forbidden-redirect')
  const res = await baseFetch(input, mergedInit)
  const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  const onLoginPage = pathname.startsWith('/login')
  const onPortalRoute = /\/[^/]+\/portal(\/|$)/.test(pathname)
  if (res.status === 401) {
    // Trigger same redirect flow as protected pages
    // Skip for staff login page and all portal routes (portal has its own auth)
    if (!onLoginPage && !onPortalRoute && !disableUnauthorizedRedirect) {
      redirectToSessionRefresh()
      // Throw a typed error for callers that might still handle it
      throw new UnauthorizedError(await res.text().catch(() => 'Unauthorized'))
    }
    return res
  }
  if (res.status === 403) {
    // Try to read requiredRoles from JSON body; ignore if not JSON
    let roles: string[] | null = null
    let features: string[] | null = null
    let payload: unknown = null
    const aclData = await readJsonSafe<Record<string, unknown>>(res.clone(), null)
    if (aclData && typeof aclData === 'object') {
      if (Array.isArray(aclData.requiredRoles)) {
        roles = aclData.requiredRoles.map((r) => String(r))
      }
      if (Array.isArray(aclData.requiredFeatures)) {
        features = aclData.requiredFeatures.map((f) => String(f))
      }
      payload = aclData
    }
    // Only redirect if not already on login page or a portal route
    if (!onLoginPage && !onPortalRoute && !disableForbiddenRedirect) {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (typeof Request !== 'undefined' && input instanceof Request)
              ? input.url
              : 'unknown'
      try {
        logger.warn('Forbidden response', {
          url: target,
          status: res.status,
          requiredRoles: roles,
          requiredFeatures: features,
          details: payload,
        })
      } catch {}
      const hasAclHints = Boolean((roles && roles.length) || (features && features.length))
      if (hasAclHints) {
        notifyForbiddenAccess({ requiredRoles: roles, requiredFeatures: features })
      }
      let msg = 'Forbidden'
      if (aclData && typeof aclData === 'object') {
        if (typeof aclData.error === 'string') {
          msg = aclData.error
        } else if (typeof aclData.message === 'string') {
          msg = aclData.message
        }
      } else {
        msg = await res.clone().text().catch(() => 'Forbidden')
      }
      throw new ForbiddenError(msg)
    }
    // If already on login, just return the response for the caller to handle
  }
  try {
    const header = res.headers.get('x-om-operation')
    const metadata = deserializeOperationMetadata(header)
    if (metadata) pushOperation(metadata)
  } catch {
    // ignore malformed headers
  }
  try {
    const warningRaw = res.headers.get('x-om-partial-index')
    if (warningRaw) {
      const parsed = JSON.parse(warningRaw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && parsed.type === 'partial_index') {
        const entity = typeof parsed.entity === 'string' ? parsed.entity : String(parsed.entity ?? '')
        if (entity) {
          const baseCount = typeof parsed.baseCount === 'number' ? parsed.baseCount : null
          const indexedCount = typeof parsed.indexedCount === 'number' ? parsed.indexedCount : null
          const scope = parsed.scope === 'global' ? 'global' : 'scoped'
          const entityLabel =
            typeof parsed.entityLabel === 'string' && parsed.entityLabel.trim()
              ? parsed.entityLabel.trim()
              : entity
          pushPartialIndexWarning({ entity, entityLabel, baseCount, indexedCount, scope })
        }
      }
    }
  } catch {
    // ignore malformed headers
  }
  return res
}
