/**
 * `AI_RUNTIME_BASEURL_ALLOWLIST` guard helper.
 *
 * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`
 * (R6 mitigation). An operator who wants to expose the `?baseUrl=` query
 * parameter over HTTP MUST set this env var to a comma-separated list of
 * allowed hosts or origins. When the env var is absent or empty, ANY non-empty
 * `baseUrl` value received by the dispatcher is rejected with a typed 400
 * error — ensuring that a misconfigured deployment cannot be tricked into
 * forwarding API calls to an attacker-controlled endpoint.
 *
 * A bare host entry allows HTTPS on the default port (443) only. Any other
 * origin — a local HTTP model server, a TLS proxy on a custom port — must be
 * listed as a full origin (`scheme://host[:port]`). A leading `*.` in the host
 * matches any subdomain (never the apex). Examples:
 *   `openrouter.ai`                        — https://openrouter.ai
 *   `*.openrouter.ai`                      — https on any subdomain of openrouter.ai
 *   `http://localhost:11434`               — a local Ollama server over plain HTTP
 *   `https://*.myproxy.io:9443`            — https on port 9443 of any subdomain
 *   `openrouter.ai,http://localhost:11434` — two entries (comma-separated)
 *
 * A submitted URL matches when its scheme, hostname and effective port all
 * match one entry. Only `http:` and `https:` URLs can match. The comparison is
 * case-insensitive and ignores the URL path/query. Entries that do not parse
 * are skipped, never widened.
 */

const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

type AllowlistEntry = {
  protocol: string
  host: string
  wildcard: boolean
  port: string
}

function effectivePort(url: URL): string | null {
  const defaultPort = DEFAULT_PORTS[url.protocol]
  if (!defaultPort) return null
  return url.port || defaultPort
}

function parseAllowlistEntry(entry: string): AllowlistEntry | null {
  let url: URL
  try {
    url = new URL(SCHEME_PREFIX.test(entry) ? entry : `https://${entry}`)
  } catch {
    return null
  }
  const port = effectivePort(url)
  if (!port) return null
  const wildcard = url.hostname.startsWith('*.')
  const host = wildcard ? url.hostname.slice(2) : url.hostname
  if (!host || host.startsWith('.') || host.includes('*')) return null
  return { protocol: url.protocol, host, wildcard, port }
}

/**
 * Returns the parsed allowlist from `AI_RUNTIME_BASEURL_ALLOWLIST`.
 * An empty array means the allowlist is empty (reject all).
 */
export function readBaseurlAllowlist(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.AI_RUNTIME_BASEURL_ALLOWLIST ?? ''
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

/**
 * Returns true when `baseUrl` is permitted under the current allowlist.
 *
 * Rules:
 *   - An empty `baseUrl` is always allowed (no override requested).
 *   - When the allowlist is empty, any non-empty `baseUrl` is rejected.
 *   - Scheme, hostname and effective port must all match one entry.
 *   - A bare host entry means `https` on port 443.
 *   - A pattern `*.example.com` matches `foo.example.com` but NOT `example.com`.
 *   - A pattern `example.com` matches only `example.com` (exact, case-insensitive).
 */
export function isBaseurlAllowlisted(baseUrl: string, allowlist: string[]): boolean {
  const trimmed = baseUrl.trim()
  if (!trimmed) return true
  if (allowlist.length === 0) return false

  let candidate: URL
  try {
    candidate = new URL(trimmed)
  } catch {
    return false
  }
  const port = effectivePort(candidate)
  if (!port) return false

  return allowlist.some((rawEntry) => {
    const entry = parseAllowlistEntry(rawEntry)
    if (!entry || entry.protocol !== candidate.protocol || entry.port !== port) return false
    return entry.wildcard ? candidate.hostname.endsWith(`.${entry.host}`) : candidate.hostname === entry.host
  })
}

/**
 * Returns the trimmed stored `baseUrl` when it is still permitted under the
 * current allowlist, or null when it is empty or no longer allowed. Stored
 * overrides are re-checked on every read so a value saved under an older or
 * wider allowlist is never used.
 */
export function resolveAllowlistedBaseurl(
  baseUrl: string | null | undefined,
  allowlist: string[] = readBaseurlAllowlist(),
): string | null {
  const trimmed = baseUrl?.trim() ?? ''
  if (!trimmed) return null
  return isBaseurlAllowlisted(trimmed, allowlist) ? trimmed : null
}
