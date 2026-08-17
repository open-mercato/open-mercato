import { z } from 'zod'
import { parseBooleanWithDefault } from '../boolean'
import { parseNumberWithDefault } from '../number'
import { createLogger } from '../logger'
import { EMAIL_STRATEGIES, type EmailStrategyName } from './transports/types'

function normalizeEnvString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function resolveDefaultEmailFromAddress(): string | undefined {
  return (
    normalizeEnvString(process.env.NOTIFICATIONS_EMAIL_FROM) ||
    normalizeEnvString(process.env.EMAIL_FROM) ||
    normalizeEnvString(process.env.ADMIN_EMAIL)
  )
}

function isEmailStrategyName(value: string): value is EmailStrategyName {
  return (EMAIL_STRATEGIES as readonly string[]).includes(value)
}

let warnedUnknownEmailStrategy = false

// `explicit` has no caller in v1; it exists so a future per-call transport
// option is an additive change to this resolver, not a new parameter.
export function resolveEmailTransportName(explicit?: EmailStrategyName): EmailStrategyName {
  if (explicit) return explicit
  const configured = normalizeEnvString(process.env.EMAIL_STRATEGY)?.toLowerCase()
  if (configured) {
    if (isEmailStrategyName(configured)) return configured
    if (!warnedUnknownEmailStrategy) {
      warnedUnknownEmailStrategy = true
      createLogger('email').warn('Unknown EMAIL_STRATEGY value; falling back to auto-detection', {
        strategy: configured,
        supported: EMAIL_STRATEGIES,
      })
    }
  }
  if (normalizeEnvString(process.env.RESEND_API_KEY)) return 'resend'
  if (normalizeEnvString(process.env.SMTP_HOST)) return 'smtp'
  return 'resend'
}

const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1),
  secure: z.boolean(),
  requireTls: z.boolean(),
  allowCleartext: z.boolean(),
  user: z.string().optional(),
  password: z.string().optional(),
  timeoutMs: z.number().int().min(1).optional(),
})

export type SmtpConfig = z.infer<typeof smtpConfigSchema>

let warnedInsecureSmtp = false

export function resolveSmtpConfig(): SmtpConfig {
  const host = normalizeEnvString(process.env.SMTP_HOST)
  if (!host) throw new Error('SMTP_NOT_CONFIGURED: set SMTP_HOST')
  const port = parseNumberWithDefault(process.env.SMTP_PORT, 587, { min: 1, integer: true })
  const secure = parseBooleanWithDefault(process.env.SMTP_SECURE, port === 465)
  const allowInsecure = parseBooleanWithDefault(process.env.OM_ALLOW_INSECURE_SMTP, false)
  const allowCleartext = !secure && allowInsecure
  if (allowCleartext && !warnedInsecureSmtp) {
    warnedInsecureSmtp = true
    createLogger('email').warn(
      'SMTP transport security is disabled via OM_ALLOW_INSECURE_SMTP; emails may be sent in cleartext',
      { host },
    )
  }
  const user = normalizeEnvString(process.env.SMTP_USER)
  const password = normalizeEnvString(process.env.SMTP_PASSWORD)
  const timeoutMsRaw = normalizeEnvString(process.env.SMTP_TIMEOUT_MS)
  const timeoutMs = timeoutMsRaw ? parseNumberWithDefault(timeoutMsRaw, 0, { min: 1, integer: true }) : undefined
  return smtpConfigSchema.parse({
    host,
    port,
    secure,
    requireTls: !secure && !allowInsecure,
    allowCleartext,
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  })
}
