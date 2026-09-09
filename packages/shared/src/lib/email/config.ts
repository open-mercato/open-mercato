import { parseBooleanWithDefault } from '../boolean'
import { getRegisteredEmailTransport } from './transport'

export function normalizeEnvString(value: string | null | undefined): string | undefined {
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

export function isEmailDeliveryDisabled(): boolean {
  const explicitlyDisabled = parseBooleanWithDefault(process.env.OM_DISABLE_EMAIL_DELIVERY, false)
  if (explicitlyDisabled) return true

  const testMode = parseBooleanWithDefault(process.env.OM_TEST_MODE, false)
  if (!testMode) return false

  const testCaptureDeliveryEnabled =
    process.env.SYSTEM_EMAIL_PROVIDER === '__test_seed__'
    && parseBooleanWithDefault(process.env.OM_ENABLE_TEST_CHANNEL_SEEDING, false)
    && parseBooleanWithDefault(process.env.OM_ENABLE_TEST_EMAIL_CAPTURE_DELIVERY, false)
  return !testCaptureDeliveryEnabled
}

export function isEmailDeliveryConfigured(): boolean {
  if (isEmailDeliveryDisabled()) return false
  if (!resolveDefaultEmailFromAddress()) return false
  const transport = getRegisteredEmailTransport()
  if (!transport) return false
  return transport.isConfigured ? transport.isConfigured() : true
}
