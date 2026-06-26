import { NextResponse } from 'next/server'
import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'

function toRelativeRedirectPath(path: string): string {
  // Strip any scheme/authority so the value is always treated as a path on the
  // current origin. Both `new URL(path, base)` and the browser would otherwise
  // honour a protocol-relative (`//host`) or backslash-smuggled value as a
  // cross-origin target supplied by a spoofed Host / X-Forwarded-Host.
  const withoutBackslashes = path.replace(/\\/g, '/')
  const rooted = withoutBackslashes.startsWith('/') ? withoutBackslashes : `/${withoutBackslashes}`
  return rooted.replace(/^\/+/, '/')
}

export function resolveTrustedRedirectBase(req: Request): string | null {
  try {
    return getSecurityEmailBaseUrl(req)
  } catch {
    return null
  }
}

export function resolveSafeRedirectLocation(req: Request, path: string): string {
  const safePath = toRelativeRedirectPath(path)
  const base = resolveTrustedRedirectBase(req)
  if (base) return new URL(safePath, base).toString()
  return safePath
}

export function buildSafeRedirectResponse(req: Request, path: string, status: number = 307): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { Location: resolveSafeRedirectLocation(req, path) },
  })
}

/**
 * @deprecated Use {@link buildSafeRedirectResponse} or {@link resolveSafeRedirectLocation}.
 * Previously derived the redirect origin from raw request headers, which
 * allowed open redirects via a spoofed Host / X-Forwarded-Host. It now returns
 * an allowlist-validated app origin when the request origin is trusted, and a
 * host-relative path otherwise — the latter may be a relative URL, so callers
 * MUST NOT pass the result to `NextResponse.redirect` (use
 * {@link buildSafeRedirectResponse} instead).
 */
export function buildRequestOriginUrl(req: Request, path: string): string {
  return resolveSafeRedirectLocation(req, path)
}
