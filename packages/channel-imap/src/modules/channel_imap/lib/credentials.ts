import { z } from 'zod'

/**
 * SSRF guard: reject hostnames that resolve to internal networks. Operators
 * configure their own IMAP/SMTP server, so the host string is attacker-controlled
 * in a per-user-channel context. Blocking these prevents the credential-validation
 * flow from acting as a port scanner or leaking the platform's outbound IP to
 * internal infrastructure (cloud metadata endpoints, kube-apiserver, RDS, etc).
 *
 * The check is conservative — we only reject obvious internal addresses. Operators
 * who need a private IMAP host can set `OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true`.
 */
const FORBIDDEN_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^localhost\./i,
  /^(127|10)\./,                                  // 127/8, 10/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,                // 172.16/12
  /^192\.168\./,                                  // 192.168/16
  /^169\.254\./,                                  // link-local + AWS metadata
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
  /^0\./,                                         // 0.0.0.0/8 reserved
  /^(::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i,  // IPv6 loopback/link-local/ULA
]

function assertSafeHost(host: string, ctx: { addIssue: (issue: { code: 'custom'; message: string }) => void }): void {
  if (process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS === 'true') return
  const lower = host.trim().toLowerCase()
  if (!lower) return
  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (pattern.test(lower)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Host appears to point at a private or loopback address. If this is intentional, an operator must set OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true.',
      })
      return
    }
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
  .strict()

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
