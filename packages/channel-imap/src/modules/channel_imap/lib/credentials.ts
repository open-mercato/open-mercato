import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

/**
 * SSRF guard: reject hostnames that resolve to internal networks. Operators
 * configure their own IMAP/SMTP server, so the host string is attacker-controlled
 * in a per-user-channel context. Blocking these prevents the credential-validation
 * flow from acting as a port scanner or leaking the platform's outbound IP to
 * internal infrastructure (cloud metadata endpoints, kube-apiserver, RDS, etc).
 *
 * The check is string-based: it rejects literal internal IPs, `localhost`, and
 * the obfuscated encodings that exist to evade such filters (IPv4-mapped IPv6,
 * decimal/hex/octal/short-form IPv4, bracketed and expanded IPv6). It does NOT
 * by itself catch a public hostname that resolves — or is DNS-rebound — to a
 * private address; that gap is closed at connect time by `resolveSafeHostAddress`
 * (`host-pinning.ts`), which resolves the host, rejects any internal resolved
 * address, and pins the connection to the validated IP. Operators with a
 * genuinely private IMAP host set `OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true`.
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
 * Classify a host as internal/loopback/metadata, ignoring the operator escape
 * hatch. Exported so the SSRF guard can be asserted directly in unit tests.
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

function assertSafeHost(host: string, ctx: { addIssue: (issue: { code: 'custom'; message: string }) => void }): void {
  if (parseBooleanWithDefault(process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS, false)) return
  if (!host.trim()) return
  if (isInternalHost(host)) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Host appears to point at a private or loopback address. If this is intentional, an operator must set OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true.',
    })
  }
}

function hostnameSchema(label: 'IMAP' | 'SMTP') {
  return z
    .string()
    .min(1, `${label} host required`)
    .max(253, `${label} host too long`)
    .superRefine((value, ctx) => assertSafeHost(value, ctx))
}

/**
 * Per-user IMAP+SMTP credentials. Validated whenever a user connects a new
 * channel (`POST /api/communication_channels/channels/connect/credentials`) and
 * before every outbound send / inbound poll.
 *
 * The hub persists this blob inside `IntegrationCredentials.credentials` (encrypted
 * at rest). Do not log credential values; the adapter logs `<redacted>` for any
 * password-shaped key.
 */
export const imapCredentialsSchema = z
  .object({
    imapHost: hostnameSchema('IMAP'),
    imapPort: z.coerce
      .number()
      .int()
      .min(1, 'IMAP port must be a positive integer')
      .max(65535, 'IMAP port must be <= 65535'),
    imapTls: z.enum(['tls', 'starttls', 'none']),
    imapUser: z.string().min(1, 'IMAP username required'),
    imapPassword: z.string().min(1, 'IMAP password required'),

    smtpHost: hostnameSchema('SMTP'),
    smtpPort: z.coerce
      .number()
      .int()
      .min(1, 'SMTP port must be a positive integer')
      .max(65535, 'SMTP port must be <= 65535'),
    smtpTls: z.enum(['tls', 'starttls', 'none']),
    smtpUser: z.string().min(1, 'SMTP username required'),
    smtpPassword: z.string().min(1, 'SMTP password required'),

    fromAddress: z.string().email('From address must be a valid email'),
  })
  // `.passthrough()` (not `.strict()`) so the connect-credential-channel command
  // can stash bookkeeping fields like `userId` alongside the user-entered
  // credentials. Strict was rejecting any extra key with "Unrecognized key" and
  // blocking outbound SMTP after a real user connected via the per-user flow.
  .passthrough()

export type ImapCredentials = z.infer<typeof imapCredentialsSchema>

/**
 * Internal poll-state stored on `CommunicationChannel.channelState` so we can
 * resume polling without re-scanning the entire mailbox each tick.
 *
 *   uidValidity — IMAP UIDVALIDITY for INBOX; if it changes we must full-resync.
 *   uidNext     — UIDNEXT for INBOX; subsequent polls fetch `<previous uidNext>:*`.
 */
export const imapChannelStateSchema = z
  .object({
    uidValidity: z.union([z.number(), z.string()]).optional(),
    uidNext: z.union([z.number(), z.string()]).optional(),
    lastFolder: z.string().optional(),
  })
  .partial()
  .passthrough()

export type ImapChannelState = z.infer<typeof imapChannelStateSchema>
