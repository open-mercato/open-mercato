/**
 * Embed framing policy (spec `2026-05-21-forms-render-surfaces.md`, D6 / R-RS-1).
 *
 * Pure, I/O-free helpers shared by the distribution Zod schema, the embed host
 * page, the embed-eligibility guard, and unit tests. They translate a
 * distribution's opt-in `settings.embed` bag into:
 *   - a normalized allowlist of frame-ancestor origins, and
 *   - the `Content-Security-Policy: frame-ancestors <...>` value that authorizes
 *     ONLY those origins to frame the `/embed/:slug` host page.
 *
 * Security posture:
 *   - Framing is disabled by default. An absent / `enabled: false` embed bag, or
 *     an empty allowlist, yields `frame-ancestors 'none'` — the page can be
 *     framed by no one (fail-closed).
 *   - Origins are validated to a strict shape: scheme + host (+ optional port),
 *     no path / query / fragment, https-only EXCEPT `localhost` / `127.0.0.1`
 *     (which may use http for local development).
 *   - The CSP value never contains `'self'` for the embed route — third-party
 *     framing is purely allowlist-driven. The app's global frame protection on
 *     every OTHER route is untouched.
 */

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Per-distribution embed configuration. Rides on the existing
 * `forms_distribution.settings` JSON column — no migration. All fields optional;
 * an absent bag means embedding is disabled.
 */
export type EmbedSettings = {
  /** Master switch. Default false. */
  enabled?: boolean
  /** Allowlisted frame-ancestor origins (drives `frame-ancestors`). */
  allowedDomains?: string[]
  /** Theme applied inside the iframe. */
  theme?: 'light' | 'dark' | 'auto'
  /** Whether the host page posts auto-resize messages. Default true. */
  autoResize?: boolean
}

/**
 * Normalizes a single origin candidate to its canonical `scheme://host[:port]`
 * form, or returns `null` when it is not an acceptable frame-ancestor origin.
 *
 * Acceptable:
 *   - parseable absolute URL with `http:` or `https:` scheme,
 *   - no path beyond `/`, no query, no fragment, no userinfo,
 *   - https required unless the host is a recognized local hostname.
 */
export function normalizeEmbedOrigin(candidate: string): string | null {
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (url.search || url.hash) return null
  if (url.pathname && url.pathname !== '/') return null
  if (!url.hostname) return null

  const isLocal = LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())
  if (url.protocol === 'http:' && !isLocal) return null

  const portSegment = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname}${portSegment}`
}

/**
 * Validates a raw allowlist, returning the de-duplicated, normalized origins.
 * Throws nothing — invalid entries are reported via `invalid`.
 */
export function normalizeAllowedDomains(domains: readonly string[] | null | undefined): {
  origins: string[]
  invalid: string[]
} {
  const origins: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const candidate of domains ?? []) {
    const normalized = normalizeEmbedOrigin(candidate)
    if (!normalized) {
      invalid.push(typeof candidate === 'string' ? candidate : String(candidate))
      continue
    }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    origins.push(normalized)
  }
  return { origins, invalid }
}

/**
 * True only when the embed bag is enabled AND carries at least one valid
 * allowlisted origin. Mirrors the save-time validation (R-RS-1): an enabled bag
 * without a usable allowlist is never considered embeddable.
 */
export function isEmbedEnabled(embed: EmbedSettings | null | undefined): boolean {
  if (!embed || embed.enabled !== true) return false
  return normalizeAllowedDomains(embed.allowedDomains).origins.length > 0
}

/**
 * Builds the `Content-Security-Policy: frame-ancestors` value for the
 * `/embed/:slug` host page from a distribution's embed bag.
 *
 * Returns `frame-ancestors 'none'` (fail-closed) whenever embedding is disabled
 * or the allowlist resolves to zero valid origins. Otherwise returns
 * `frame-ancestors <space-separated origins>`.
 */
export function buildFrameAncestorsCsp(embed: EmbedSettings | null | undefined): string {
  if (!embed || embed.enabled !== true) return "frame-ancestors 'none'"
  const { origins } = normalizeAllowedDomains(embed.allowedDomains)
  if (origins.length === 0) return "frame-ancestors 'none'"
  return `frame-ancestors ${origins.join(' ')}`
}

/**
 * Reads and shallow-validates an `EmbedSettings` bag out of an untyped
 * `distribution.settings` JSON column. Returns `null` when absent or malformed.
 */
export function readEmbedSettings(
  settings: Record<string, unknown> | null | undefined,
): EmbedSettings | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const embed = (settings as Record<string, unknown>).embed
  if (!embed || typeof embed !== 'object' || Array.isArray(embed)) return null
  const record = embed as Record<string, unknown>
  const theme = record.theme
  return {
    enabled: record.enabled === true,
    allowedDomains: Array.isArray(record.allowedDomains)
      ? record.allowedDomains.filter((entry): entry is string => typeof entry === 'string')
      : [],
    theme: theme === 'light' || theme === 'dark' || theme === 'auto' ? theme : undefined,
    autoResize: record.autoResize === false ? false : true,
  }
}
