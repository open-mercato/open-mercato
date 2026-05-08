/**
 * `AI_RUNTIME_BASEURL_ALLOWLIST` guard helper.
 *
 * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`
 * (R6 mitigation). An operator who wants to expose the `?baseUrl=` query
 * parameter over HTTP MUST set this env var to a comma-separated list of
 * allowed host patterns. When the env var is absent or empty, ANY non-empty
 * `baseUrl` value received by the dispatcher is rejected with a typed 400
 * error — ensuring that a misconfigured deployment cannot be tricked into
 * forwarding API calls to an attacker-controlled endpoint.
 *
 * Host patterns use a simple glob: a leading `*` matches any subdomain.
 * Examples:
 *   `openrouter.ai`               — exact host
 *   `*.openrouter.ai`             — any subdomain of openrouter.ai
 *   `openrouter.ai,api.myproxy.io` — two hosts (comma-separated, no spaces)
 *
 * The comparison is case-insensitive and ignores the URL path/query —
 * only the `hostname` portion of the submitted URL is checked.
 */

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
 *   - A pattern `*.example.com` matches `foo.example.com` but NOT `example.com`.
 *   - A pattern `example.com` matches only `example.com` (exact, case-insensitive).
 */
export function isBaseurlAllowlisted(baseUrl: string, allowlist: string[]): boolean {
  const trimmed = baseUrl.trim()
  if (!trimmed) return true
  if (allowlist.length === 0) return false

  let parsedHostname: string
  try {
    parsedHostname = new URL(trimmed).hostname.toLowerCase()
  } catch {
    return false
  }

  for (const pattern of allowlist) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      if (parsedHostname.endsWith(`.${suffix}`)) return true
    } else if (pattern === parsedHostname) {
      return true
    }
  }
  return false
}
