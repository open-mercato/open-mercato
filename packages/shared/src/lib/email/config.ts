function normalizeEnvString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export type EmailProvider = 'resend' | 'ses'

export function resolveEmailProvider(): EmailProvider {
  const raw = normalizeEnvString(process.env.EMAIL_PROVIDER)
  if (!raw) return 'resend'
  const normalized = raw.toLowerCase()
  if (normalized === 'resend') return 'resend'
  if (normalized === 'ses') return 'ses'
  throw new Error(`EMAIL_PROVIDER_UNSUPPORTED: ${raw}`)
}

export function resolveAwsSesRegion(): string | undefined {
  return normalizeEnvString(process.env.AWS_SES_REGION) || normalizeEnvString(process.env.AWS_REGION)
}

export function resolveDefaultEmailFromAddress(): string | undefined {
  return (
    normalizeEnvString(process.env.NOTIFICATIONS_EMAIL_FROM) ||
    normalizeEnvString(process.env.EMAIL_FROM) ||
    normalizeEnvString(process.env.ADMIN_EMAIL)
  )
}

export function isEmailDeliveryDisabled(): boolean {
  return (
    process.env.OM_DISABLE_EMAIL_DELIVERY === 'true' ||
    process.env.OM_DISABLE_EMAIL_DELIVERY === '1' ||
    process.env.OM_TEST_MODE === 'true' ||
    process.env.OM_TEST_MODE === '1'
  )
}

export function isEmailDeliveryConfigured(): boolean {
  if (isEmailDeliveryDisabled()) return false
  if (!resolveDefaultEmailFromAddress()) return false
  let provider: EmailProvider
  try {
    provider = resolveEmailProvider()
  } catch {
    return false
  }
  if (provider === 'ses') return true
  return Boolean(normalizeEnvString(process.env.RESEND_API_KEY))
}
