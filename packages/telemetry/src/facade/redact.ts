import type { Attributes } from '../types'

/**
 * Active redaction backstop for telemetry (Privacy section of the telemetry spec).
 *
 * Defense-in-depth over the don't-emit posture: callers are expected not to put
 * PII or secrets into errors/logs, but error messages and stack frames can still
 * pick them up a layer down (e.g. `Error: no user for jan.kowalski@example.com`,
 * or a dumped `Authorization: Bearer …` header). This scrubs the highest-signal
 * identifiers — email addresses and auth tokens — from any text that ships to the
 * backend, without touching opaque UUIDs/ids (which we keep).
 *
 * Deliberately conservative (emails + auth tokens) to preserve debuggability;
 * extend the pattern set here if a new leak vector is found.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// `authorization: <value>` / `cookie: <value>` header dumps embedded in free text.
// The value runs to the next separator (`;`/`,`/`}`) or newline, so it swallows a
// `Bearer <token>` value in one pass (before the standalone-scheme rule below).
const SECRET_HEADER_RE = /\b(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)([^\n;,}]+)/gi
// `Bearer <token>` / `Basic <base64>` / `ApiKey <key>` standing alone in free text (message or stack).
const AUTH_SCHEME_RE = /\b(Bearer|Basic|ApiKey)\s+[A-Za-z0-9._~+/=-]+/gi

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(SECRET_HEADER_RE, (_match, name: string, separator: string) => `${name}${separator}[redacted]`)
    .replace(AUTH_SCHEME_RE, (_match, scheme: string) => `${scheme} [redacted]`)
}

// Attribute KEYS whose value is a secret regardless of content. Intentionally
// specific enough not to clobber benign fields like `token_count`, while
// still masking the exact key `token`.
const SECRET_KEY_RE =
  /(authorization|cookie|password|passwd|\bpwd\b|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|^token$|\bbearer\b|private[-_]?key|credential)/i

/**
 * Redact a telemetry attribute bag before it ships: a value under a secret-looking
 * KEY (`authorization`, `set-cookie`, `client_secret`, `x-api-key`, …) is masked
 * wholesale; other string values still pass through `redactPii` so an inline email
 * or auth token is caught too. Non-string values are left as-is.
 */
export function redactAttributes(attributes: Attributes): Attributes {
  const result: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (SECRET_KEY_RE.test(key)) result[key] = '[redacted]'
    else if (typeof value === 'string') result[key] = redactPii(value)
    else result[key] = value
  }
  return result
}
