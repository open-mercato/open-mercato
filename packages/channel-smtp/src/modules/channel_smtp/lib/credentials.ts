import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isInternalHost } from '@open-mercato/shared/lib/host-pinning'

export const SMTP_TLS_MODES = ['tls', 'starttls', 'none'] as const

export type SmtpTlsMode = (typeof SMTP_TLS_MODES)[number]

export function allowsInternalHosts(): boolean {
  return parseBooleanWithDefault(process.env.OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS, false)
}

export function allowsInsecureTransport(): boolean {
  return parseBooleanWithDefault(process.env.OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT, false)
}

export const INTERNAL_HOST_MESSAGE =
  'Host resolves to a private or loopback address. If this is intentional, an operator must set OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS=true.'

export const UNRESOLVABLE_HOST_MESSAGE = 'SMTP host did not resolve to any address.'

export const INSECURE_TRANSPORT_MESSAGE =
  'Cleartext SMTP sends the password and the message over the wire unencrypted. Use starttls or tls, or set OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT=true.'

/**
 * The relay host is operator-supplied and dialled as a raw socket, so it gets the
 * same two-layer SSRF treatment as IMAP: this cheap string check at save time, and
 * DNS-rebinding-safe pinning at connect time in `transport.ts`. Both layers live in
 * `@open-mercato/shared/lib/host-pinning`.
 */
const hostSchema = z
  .string()
  .trim()
  .min(1, 'SMTP host required')
  .max(253, 'SMTP host too long')
  .superRefine((value, ctx) => {
    if (allowsInternalHosts()) return
    if (isInternalHost(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'SMTP host appears to point at a private or loopback address. If this is intentional, an operator must set OM_CHANNEL_SMTP_ALLOW_INTERNAL_HOSTS=true.',
      })
    }
  })

/**
 * Tenant-wide SMTP relay credentials. Persisted inside
 * `IntegrationCredentials.credentials` (encrypted at rest) and re-parsed before
 * every send, so a relay reconfigured to cleartext behind our back is rejected on
 * the next send rather than only at setup time.
 *
 * Never log credential values.
 */
export const smtpCredentialsSchema = z
  .object({
    host: hostSchema,
    port: z.coerce
      .number()
      .int()
      .min(1, 'SMTP port must be a positive integer')
      .max(65535, 'SMTP port must be <= 65535'),
    tls: z.enum(SMTP_TLS_MODES).superRefine((value, ctx) => {
      if (value !== 'none') return
      if (allowsInsecureTransport()) return
      ctx.addIssue({ code: 'custom', message: INSECURE_TRANSPORT_MESSAGE })
    }),
    user: z.string().min(1, 'SMTP username required'),
    password: z.string().min(1, 'SMTP password required'),
    fromAddress: z.string().email('From address must be a valid email'),
  })
  // `.passthrough()` rather than `.strict()`: the integrations credential store
  // stashes bookkeeping keys alongside the operator-entered fields, and a strict
  // schema would reject the blob it just persisted.
  .passthrough()

export type SmtpCredentials = z.infer<typeof smtpCredentialsSchema>
