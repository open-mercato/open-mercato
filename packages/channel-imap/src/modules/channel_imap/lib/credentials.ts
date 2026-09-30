import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isInternalHost } from '@open-mercato/shared/lib/host-pinning'

/**
 * SSRF guard: reject hostnames that resolve to internal networks. Operators
 * configure their own IMAP/SMTP server, so the host string is attacker-controlled
 * in a per-user-channel context. Blocking these prevents the credential-validation
 * flow from acting as a port scanner or leaking the platform's outbound IP to
 * internal infrastructure (cloud metadata endpoints, kube-apiserver, RDS, etc).
 *
 * Re-exported from `@open-mercato/shared/lib/host-pinning` rather than
 * implemented here: the same guard protects every provider that dials an
 * operator-supplied host:port (IMAP/SMTP here, the SMTP relay in
 * `@open-mercato/channel-smtp`), and an SSRF classifier that drifts between two
 * copies is worse than no shared copy at all. The import path is unchanged.
 *
 * The check is string-based and does NOT by itself catch a public hostname that
 * resolves — or is DNS-rebound — to a private address; that gap is closed at
 * connect time by `resolveSafeHostAddress` (`host-pinning.ts`), which resolves
 * the host, rejects any internal resolved address, and pins the connection to the
 * validated IP. Operators with a genuinely private IMAP host set
 * `OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true`.
 */
export { isInternalHost } from '@open-mercato/shared/lib/host-pinning'

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
