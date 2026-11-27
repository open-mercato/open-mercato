/**
 * Retry window and default retry delay for per-recipient email delivery.
 *
 * Read at call time so a deployment can change them without a rebuild and tests
 * can exercise the override; anything that is not a positive integer falls back
 * to the built-in default.
 */

export const EMAIL_DELIVERY_MAX_HOURS_ENV = 'OM_EMAIL_DELIVERY_MAX_HOURS'
export const EMAIL_DELIVERY_RETRY_DELAY_SECONDS_ENV = 'OM_EMAIL_DELIVERY_RETRY_DELAY_SECONDS'

export const DEFAULT_EMAIL_DELIVERY_MAX_HOURS = 24
export const DEFAULT_EMAIL_DELIVERY_RETRY_DELAY_SECONDS = 300

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const trimmed = raw?.trim() ?? ''
  if (!/^\d+$/.test(trimmed)) return fallback
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getEmailDeliveryMaxHours(): number {
  return readPositiveIntEnv(EMAIL_DELIVERY_MAX_HOURS_ENV, DEFAULT_EMAIL_DELIVERY_MAX_HOURS)
}

export function getEmailDeliveryRetryDelaySeconds(): number {
  return readPositiveIntEnv(EMAIL_DELIVERY_RETRY_DELAY_SECONDS_ENV, DEFAULT_EMAIL_DELIVERY_RETRY_DELAY_SECONDS)
}
