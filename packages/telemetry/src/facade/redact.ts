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
// Bound every component both to match the practical limits from RFC 5321 and
// to keep scanning time linear for hostile strings with long runs of email
// punctuation (CodeQL js/polynomial-redos).
const EMAIL_RE = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi
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

const UUID_PATH_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const URL_ATTRIBUTE_KEYS = new Set(['http.target', 'http.url', 'url.full', 'url.path'])

function redactQuery(query: string): string {
  return query.split('&').map((parameter) => {
    const separator = parameter.indexOf('=')
    return separator < 0 ? parameter : `${parameter.slice(0, separator)}=[redacted]`
  }).join('&')
}

function redactPathSegment(segment: string): string {
  if (/%(?![0-9a-f]{2})/i.test(segment)) return '[redacted]'
  const decoded = segment.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
  return /^[A-Za-z0-9_-]{32,}$/.test(decoded) && !UUID_PATH_SEGMENT_RE.test(decoded)
    ? '[redacted]'
    : segment
}

export function redactUrl(url: string): string {
  const fragmentIndex = url.indexOf('#')
  const withoutFragment = fragmentIndex < 0 ? url : url.slice(0, fragmentIndex)
  const queryIndex = withoutFragment.indexOf('?')
  const path = queryIndex < 0 ? withoutFragment : withoutFragment.slice(0, queryIndex)
  const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/]*/i.exec(path)?.[0] ?? ''
  const userInfoEnd = authority.lastIndexOf('@')
  const redactedAuthority = userInfoEnd < 0
    ? authority
    : `${authority.slice(0, authority.indexOf('//') + 2)}${authority.slice(userInfoEnd + 1)}`
  const redactedPath = path.slice(authority.length).split('/').map(redactPathSegment).join('/')
  const query = queryIndex < 0 ? '' : `?${redactQuery(withoutFragment.slice(queryIndex + 1))}`
  const fragment = fragmentIndex < 0 ? '' : '#[redacted]'
  return `${redactedAuthority}${redactedPath}${query}${fragment}`
}

export function redactSpanName(name: string): string {
  return redactPii(name.split(/(\s+)/).map((part) =>
    part.startsWith('/') || /^[a-z][a-z0-9+.-]{0,31}:\/\//i.test(part) ? redactUrl(part) : part,
  ).join(''))
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
    else if (typeof value === 'string') {
      const cleaned = key === 'next.span_name'
        ? redactSpanName(value)
        : key === 'url.query' ? redactQuery(value) : URL_ATTRIBUTE_KEYS.has(key) ? redactUrl(value) : value
      result[key] = redactPii(cleaned)
    }
    else result[key] = value
  }
  return result
}
