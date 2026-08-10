/**
 * Strip secret-shaped values out of a tool call's request/response summary
 * before it is persisted.
 *
 * The MCP contract instructs the model to pass `_sessionToken` in EVERY tool
 * call, and the trace pipeline stores raw tool arguments verbatim. So a live
 * credential was landing in `agent_tool_calls.request_summary` and rendering on
 * the trace detail page, which `agent_orchestrator.trace.view` grants to the
 * `employee` role by default. The token is short-lived and proactively revoked,
 * but a trace row outlives it in backups, exports and any DB reader.
 *
 * Redaction happens at INGESTION rather than at render: the database is the
 * exposure, not the page. A value hidden only by the UI is still in the row.
 *
 * The key list is deliberately narrow, matching the conservative style of
 * `lib/context/redactor.ts` — a trace exists to be debugged from, so hiding an
 * ordinary argument costs real diagnostic value. Only names that are secrets by
 * definition are matched.
 */

/** Replaces a redacted value, so a reader sees that something was removed. */
export const REDACTED_PLACEHOLDER = '[redacted]'

/**
 * Matched case-insensitively against both the raw key and its snake_case form,
 * so `_sessionToken`, `sessionToken` and `session_token` all match one entry.
 */
const SECRET_KEY_PATTERNS: RegExp[] = [
  /^_?session_?token$/i,
  /^api_?key$/i,
  /^access_?token$/i,
  /^refresh_?token$/i,
  /^bearer_?token$/i,
  /^auth(orization)?$/i,
  /^password$/i,
  /^secret$/i,
  /^client_?secret$/i,
  /^private_?key$/i,
  /^credentials?$/i,
]

function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function isSecretKey(key: string): boolean {
  const bare = key.replace(/^_+/, '')
  const candidates = [key, bare, toSnakeCase(key), toSnakeCase(bare)]
  return SECRET_KEY_PATTERNS.some((pattern) => candidates.some((candidate) => pattern.test(candidate)))
}

/**
 * Walks arrays and plain objects, replacing the value of any secret-shaped key.
 * Non-plain values (dates, class instances) are returned as-is: a tool summary
 * is JSON that crossed the wire, so anything exotic is already a string.
 *
 * Cycles cannot occur in parsed JSON, but a `seen` set guards the case where a
 * caller hands in a live object graph rather than a decoded payload.
 */
export function redactSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    return value.map((entry) => redactSecrets(entry, seen)) as unknown as T
  }
  if (value === null || typeof value !== 'object') return value
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
  if (seen.has(value as object)) return value
  seen.add(value as object)

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED_PLACEHOLDER : redactSecrets(entry, seen)
  }
  return out as unknown as T
}
