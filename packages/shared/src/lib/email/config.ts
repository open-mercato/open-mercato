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
  const explicitDisabled = normalizeEnvString(process.env.OM_DISABLE_EMAIL_DELIVERY)
  if (explicitDisabled !== undefined) {
    return parseBooleanWithDefault(explicitDisabled, false)
  }
  return parseBooleanWithDefault(process.env.OM_TEST_MODE, false)
}

export function isEmailDeliveryConfigured(): boolean {
  if (isEmailDeliveryDisabled()) return false
  if (!resolveDefaultEmailFromAddress()) return false
  const transport = getRegisteredEmailTransport()
  if (!transport) return false
  return transport.isConfigured ? transport.isConfigured() : true
}
