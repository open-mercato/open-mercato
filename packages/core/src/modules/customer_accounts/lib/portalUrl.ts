// Resolve the browser-visible origin on the server so the admin portal-address
// hints are already correct in the first server-rendered paint. Deriving the
// origin from `window.location.origin` during render made the server HTML and
// the hydrated client output disagree, which React reported as a hydration
// error and repaired with a visible flicker of the portal address (#5457).

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
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

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
  // A terminating proxy that omits the header is serving a public hostname over
  // TLS far more often than not; only loopback development hosts default to http.
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
 */
export function resolveRequestOrigin(headers: RequestHeaderReader | null | undefined): string {
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

/** Portal entry point used by the "Open Portal" action on admin pages. */
export function buildPortalRootUrl(origin: string | null | undefined): string {
  return `${normalizeOrigin(origin)}/portal`
}
