import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for operator-supplied *host:port* endpoints — mail relays, IMAP
 * servers, anything dialled as a raw socket rather than as a URL.
 *
 * `url-safety.ts` covers the URL-shaped outbound case (protocol, credentials in
 * the URL, `fetch` dispatcher pinning). This module covers the socket-shaped one:
 * the host string is attacker-controlled in a per-tenant credential blob, so
 * without a guard the credential-validation flow doubles as a port scanner and
 * can leak the platform's outbound IP to internal infrastructure (cloud metadata
 * endpoints, kube-apiserver, RDS).
 *
 * Two layers, both needed:
 *
 * - {@link isInternalHost} — cheap, synchronous, string-based. Runs inside zod
 *   credential schemas. Rejects literal internal IPs, `localhost`, and the
 *   obfuscated encodings that exist to evade such filters (IPv4-mapped IPv6,
 *   decimal/hex/octal/short-form IPv4, bracketed and expanded IPv6). It cannot
 *   catch a public hostname that resolves to a private address.
 * - {@link resolveSafeHostAddress} — asynchronous, runs at connect time. Closes
 *   that gap and the DNS-rebinding window by resolving the host, rejecting the
 *   result if *any* address is internal, and returning the validated IP for the
 *   caller to dial, so there is no second lookup an attacker could race.
 *
 * Deliberately independent of `network.ts`'s `isBlockedHostname` /
 * `isPrivateIpAddress`, which are tuned for URL hostnames: they classify an empty
 * string as blocked and do not detect obfuscated IPv4 literals. Callers here need
 * the opposite bias — an empty host is a missing-field error for the schema to
 * report, not an SSRF attempt.
 */

const FORBIDDEN_HOST_NAMES = new Set([
  'localhost',
  'localhost6',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
])

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^(127|10)\./,                                    // 127/8 loopback, 10/8 private
  /^172\.(1[6-9]|2[0-9]|3[01])\./,                  // 172.16/12 private
  /^192\.168\./,                                    // 192.168/16 private
  /^169\.254\./,                                    // link-local + cloud metadata (169.254.169.254)
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
  /^0\./,                                           // 0.0.0.0/8 reserved
]

const PRIVATE_IPV6_PATTERNS: RegExp[] = [
  /^::$/,                                            // unspecified
  /^::1$/,                                           // loopback
  /^::ffff:/,                                        // IPv4-mapped (hex-group form; dotted form is unwrapped first)
  /^(fc|fd)[0-9a-f]{0,2}:/,                          // unique-local fc00::/7
  /^fe80:/,                                          // link-local
  /^(0{1,4}:){7}0{0,3}1$/,                           // fully-expanded loopback
  /^(0{1,4}:){7}0{1,4}$/,                            // fully-expanded unspecified
]

function isDottedDecimalQuad(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * True when `host` is an obfuscated IPv4 encoding — decimal integer
 * (`2130706433`), hex (`0x7f.0.0.1`), octal (`0177.0.0.1`) or short form
 * (`127.1`). These forms exist almost exclusively to bypass SSRF string filters,
 * so we reject them outright; legitimate operators use a hostname or a standard
 * dotted-decimal quad.
 */
function isObfuscatedIpv4(host: string): boolean {
  if (host.includes(':')) return false
  if (/^\d+$/.test(host)) return true
  if (/(^|\.)0x[0-9a-f]+/.test(host)) return true
  const labels = host.split('.')
  if (!labels.every((label) => /^[0-9a-f]+$/.test(label))) return false
  if (isDottedDecimalQuad(host) && !labels.some((label) => label.length > 1 && label.startsWith('0'))) return false
  return true
}

function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  const mappedIpv4 = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mappedIpv4) return mappedIpv4[1]
  return host
}

/**
 * Classify a host as internal/loopback/metadata, ignoring any caller escape
 * hatch. An empty or whitespace-only host is NOT internal — that is a missing
 * required field, and reporting it as an SSRF attempt would mislead the operator.
 */
export function isInternalHost(rawHost: string): boolean {
  const host = normalizeHost(rawHost)
  if (!host) return false
  if (FORBIDDEN_HOST_NAMES.has(host) || host.endsWith('.localhost')) return true
  if (host.includes(':')) return PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(host))
  if (isObfuscatedIpv4(host)) return true
  // Only treat the private-range patterns as internal for a real dotted-decimal
  // quad. Otherwise a hostname whose first label merely looks like a private
  // range (e.g. `0.mx.example.com`, `10.example.com`) is wrongly rejected.
  // Obfuscated/short IPv4 forms were already caught above, so anything reaching
  // here is either a quad or a genuine hostname.
  return isDottedDecimalQuad(host) && PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))
}

export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>

export const DEFAULT_INTERNAL_HOST_MESSAGE = 'Host resolves to a private or loopback address.'

export const DEFAULT_UNRESOLVABLE_HOST_MESSAGE = 'Host did not resolve to any address.'

export type ResolveSafeHostOptions = {
  lookup?: HostLookup
  /**
   * Operator escape hatch for a genuinely internal endpoint. Each caller owns its
   * own env var (`OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS`, …) and passes the result
   * here, so this module stays free of provider-specific configuration.
   */
  allowInternal?: boolean
  /** Rejection message, so each caller can name its own escape-hatch variable. */
  internalMessage?: string
  unresolvableMessage?: string
}

export type SafeHostAddress = {
  /** The address to dial: the literal IP when the host was one, else a validated resolved IP. */
  host: string
  /** Original hostname, for TLS SNI + certificate hostname verification. */
  servername?: string
}

/**
 * Resolve `host` to an IP, assert every resolved address is public, and pin the
 * connection to that IP.
 *
 * - Literal IPs are returned unchanged (with no `servername`) after an internal check.
 * - Hostnames are resolved to every A/AAAA record; if ANY resolved address is
 *   internal the call throws. The validated IP comes back as `host` and the
 *   original hostname as `servername`, so TLS still verifies against the real
 *   host even though the socket dials an IP.
 * - With `allowInternal`, resolution is skipped and the host is used verbatim.
 */
export async function resolveSafeHostAddress(
  host: string,
  options: ResolveSafeHostOptions = {},
): Promise<SafeHostAddress> {
  const trimmed = host.trim()
  const internalMessage = options.internalMessage ?? DEFAULT_INTERNAL_HOST_MESSAGE
  if (options.allowInternal) return { host: trimmed }
  const bare = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  if (isIP(bare) !== 0) {
    if (isInternalHost(trimmed)) throw new Error(`[internal] ${internalMessage}`)
    return { host: trimmed }
  }
  const resolve = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }))
  const records = await resolve(trimmed)
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`[internal] ${options.unresolvableMessage ?? DEFAULT_UNRESOLVABLE_HOST_MESSAGE}`)
  }
  for (const record of records) {
    if (isInternalHost(record.address)) throw new Error(`[internal] ${internalMessage}`)
  }
  return { host: records[0].address, servername: trimmed }
}
