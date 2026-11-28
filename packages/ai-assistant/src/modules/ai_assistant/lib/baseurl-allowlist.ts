import { normalizeProviderId } from './model-allowlist'

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
 * match one entry. A scoped entry (`provider-id=https://proxy.example`) also
 * requires the matching provider. Only HTTP(S) URLs can match.
 */

const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }
const SCOPED_ENTRY = /^([a-z0-9][a-z0-9_.-]*)=(https?:\/\/(?:\[[\da-f:.]+\]|[^:[\]/?#@\\\s=%]+)(?::\d+)?\/?)$/i

type AllowlistEntry = {
  protocol: string
  host: string
  wildcard: boolean
  port: string
  providerId?: string
}

function effectivePort(url: URL): string | null {
  const defaultPort = DEFAULT_PORTS[url.protocol]
  if (!defaultPort) return null
  return url.port || defaultPort
}

function parseAllowlistEntry(entry: string): AllowlistEntry | null {
  const scoped = SCOPED_ENTRY.exec(entry)
  if (!scoped && /^[^/:?#]*=/.test(entry)) return null
  const origin = scoped?.[2] ?? entry
  let url: URL
  try {
    url = new URL(SCHEME_PREFIX.test(origin) ? origin : `https://${origin}`)
  } catch {
    return null
  }
  const port = effectivePort(url)
  if (!port) return null
  const wildcard = url.hostname.startsWith('*.')
  const host = wildcard ? url.hostname.slice(2) : url.hostname
  if (!host || host.startsWith('.') || host.includes('*')) return null
  return { protocol: url.protocol, host, wildcard, port, providerId: scoped?.[1] }
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

function matchesBaseurlRule(
  baseUrl: string,
  allowlist: string[],
  acceptsProvider: (providerId: string | undefined) => boolean,
): boolean {
  let candidate: URL
  try {
    candidate = new URL(baseUrl)
  } catch {
    return false
  }
  const port = effectivePort(candidate)
  if (!port) return false

  return allowlist.some((rawEntry) => {
    const entry = parseAllowlistEntry(rawEntry)
    if (!entry || entry.protocol !== candidate.protocol || entry.port !== port || !acceptsProvider(entry.providerId)) {
      return false
    }
    return entry.wildcard ? candidate.hostname.endsWith(`.${entry.host}`) : candidate.hostname === entry.host
  })
}

/** Checks the origin and, for scoped entries, the effective provider. */
export function isBaseurlAllowlisted(
  baseUrl: string,
  allowlist: string[],
  providerId?: string,
  knownProviderIds: readonly string[] = providerId ? [providerId] : [],
): boolean {
  const trimmed = baseUrl.trim()
  if (!trimmed) return true
  return matchesBaseurlRule(trimmed, allowlist, (scope) => {
    if (scope === undefined) return true
    if (providerId === undefined) return false
    const exact = knownProviderIds.filter((id) => id.toLowerCase() === scope.toLowerCase())
    const candidates = exact.length > 0
      ? exact
      : knownProviderIds.filter((id) => normalizeProviderId(id) === normalizeProviderId(scope))
    return candidates.length === 1 && candidates[0] === providerId
  })
}

/** Origin-only precheck. Scoped authorization still requires the resolved provider. */
export function matchesScopedBaseurlOrigin(baseUrl: string, allowlist: string[]): boolean {
  return matchesBaseurlRule(baseUrl.trim(), allowlist, (scope) => scope !== undefined)
}

export class RuntimeBaseurlNotAllowlistedError extends Error {
  readonly code = 'baseurl_not_allowlisted'

  constructor() {
    super('The runtime base URL is not allowed by AI_RUNTIME_BASEURL_ALLOWLIST for the effective provider.')
    this.name = 'RuntimeBaseurlNotAllowlistedError'
  }
}

export function assertRuntimeBaseurlAllowed(
  baseUrl: string,
  allowlist: string[],
  providerId: string,
  knownProviderIds: readonly string[],
): void {
  if (!isBaseurlAllowlisted(baseUrl, allowlist, providerId, knownProviderIds)) {
    throw new RuntimeBaseurlNotAllowlistedError()
  }
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
  providerId?: string,
  knownProviderIds?: readonly string[],
): string | null {
  const trimmed = baseUrl?.trim() ?? ''
  if (!trimmed) return null
  return isBaseurlAllowlisted(trimmed, allowlist, providerId, knownProviderIds) ? trimmed : null
}
