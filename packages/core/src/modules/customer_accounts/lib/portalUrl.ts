// Resolve the browser-visible origin on the server so the admin portal-address
// hints are already correct in the first server-rendered paint. Deriving the
// origin from `window.location.origin` during render made the server HTML and
// the hydrated client output disagree, which React reported as a hydration
// error and repaired with a visible flicker of the portal address (#5457).
//
// `resolvePortalRequestOrigin` is deliberately named apart from the shared
// `resolveRequestOrigin` in `@open-mercato/shared/lib/url`: that one takes a
// `Request` and reads the protocol off `req.url`, which a server component does
// not have — it only has `headers()`. This one also validates the untrusted host
// header before the value reaches rendered text or a link href, and infers the
// protocol when the proxy stays quiet, so the two are not interchangeable.

export type RequestHeaderReader = {
  get(name: string): string | null | undefined
}

const FORWARDED_HOST_HEADER = 'x-forwarded-host'
const HOST_HEADER = 'host'
const FORWARDED_PROTO_HEADER = 'x-forwarded-proto'

// Host headers are client-controlled, so only a plain `host[:port]` or bracketed
// IPv6 literal is accepted before it reaches rendered text and link hrefs.
const HOST_PATTERN = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i
const PROTOCOL_PATTERN = /^https?$/i
// Bracketed, because HOST_PATTERN only accepts a colon-bearing host in that form.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const PORTAL_ORG_SLUG_PLACEHOLDER = '[org-slug]'

function firstHeaderValue(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  // Proxy chains append values, so the client-facing hop is the first entry.
  const value = raw.split(',')[0]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function readHost(headers: RequestHeaderReader): string | null {
  const forwarded = firstHeaderValue(headers.get(FORWARDED_HOST_HEADER))
  const host = forwarded ?? firstHeaderValue(headers.get(HOST_HEADER))
  if (!host) return null
  return HOST_PATTERN.test(host) ? host.toLowerCase() : null
}

function readProtocol(headers: RequestHeaderReader, host: string): string {
  const forwarded = firstHeaderValue(headers.get(FORWARDED_PROTO_HEADER))
  if (forwarded && PROTOCOL_PATTERN.test(forwarded)) return forwarded.toLowerCase()
  // An operator who configured APP_URL has named the canonical origin explicitly;
  // when it points at this very host, trust it over any inference below. Without
  // this, a plain-HTTP deployment behind a proxy that omits x-forwarded-proto
  // would render https:// links that do not work.
  const configured = configuredOrigin()
  if (configured) {
    try {
      const parsed = new URL(configured)
      if (parsed.host.toLowerCase() === host) return parsed.protocol.replace(':', '')
    } catch {
      // configuredOrigin() already parsed this successfully; ignore defensively.
    }
  }
  // Otherwise a terminating proxy that omits the header is serving a public
  // hostname over TLS far more often than not; only loopback hosts default to http.
  const hostname = host.replace(/:\d{1,5}$/, '')
  return LOOPBACK_HOSTS.has(hostname) ? 'http' : 'https'
}

function configuredOrigin(): string {
  const candidates = [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value) continue
    try {
      const parsed = new URL(value)
      if (PROTOCOL_PATTERN.test(parsed.protocol.replace(':', ''))) return parsed.origin
    } catch {
      // A malformed APP_URL must not break the page — fall through to the next candidate.
    }
  }
  return ''
}

/**
 * Resolve the origin the current request was made to, mirroring the value
 * `window.location.origin` reports in the browser. Falls back to the configured
 * app URL, then to an empty string so callers render a root-relative path that
 * is identical on the server and the client.
 *
 * Named apart from `resolveRequestOrigin` in `@open-mercato/shared/lib/url` —
 * see the note at the top of this file for why the two cannot be merged.
 */
export function resolvePortalRequestOrigin(headers: RequestHeaderReader | null | undefined): string {
  if (headers && typeof headers.get === 'function') {
    const host = readHost(headers)
    if (host) return `${readProtocol(headers, host)}://${host}`
  }
  return configuredOrigin()
}

function normalizeOrigin(origin: string | null | undefined): string {
  if (typeof origin !== 'string') return ''
  return origin.trim().replace(/\/+$/, '')
}

/** Display pattern for a tenant portal address, e.g. `https://app.example.com/[org-slug]/portal`. */
export function buildPortalUrlPattern(origin: string | null | undefined): string {
  return `${normalizeOrigin(origin)}/${PORTAL_ORG_SLUG_PLACEHOLDER}/portal`
}

/**
 * Portal entry point used by the "Open Portal" action on admin pages.
 *
 * Portal pages are only ever mounted at `frontend/[orgSlug]/portal/**`, so a URL
 * without the organization segment cannot resolve and renders a 404 (#5668).
 * The slug stays optional to keep this signature backward compatible; callers
 * that cannot resolve one should hide the action rather than link to the
 * slugless fallback.
 */
export function buildPortalRootUrl(origin: string | null | undefined, orgSlug?: string | null): string {
  const base = normalizeOrigin(origin)
  const slug = typeof orgSlug === 'string' ? orgSlug.trim() : ''
  if (!slug) return `${base}/portal`
  return `${base}/${encodeURIComponent(slug)}/portal`
}
