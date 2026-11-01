import type { EmailDeliveryMode, ResolvedEmailPayload } from '@open-mercato/shared/lib/email/send'
import { normalizeEnvString } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'system-email-delivery-mode' })

let warnedUnknownMode = false

/**
 * Instance-wide delivery mode from `OM_SYSTEM_EMAIL_DELIVERY`. Anything other than `queued` keeps
 * today's synchronous delivery; an unrecognised value is warned about once instead of failing sends.
 */
export function resolveConfiguredSystemEmailDeliveryMode(): EmailDeliveryMode {
  const configured = normalizeEnvString(process.env.OM_SYSTEM_EMAIL_DELIVERY)?.toLowerCase()
  if (!configured || configured === 'sync') return 'sync'
  if (configured === 'queued') return 'queued'
  if (!warnedUnknownMode) {
    warnedUnknownMode = true
    logger.warn('Unknown OM_SYSTEM_EMAIL_DELIVERY value; falling back to synchronous delivery', {
      value: configured,
      allowed: ['sync', 'queued'],
    })
  }
  return 'sync'
}

/**
 * Delivery mode for one send. A tenantless send is always synchronous: a queued row must be encrypted
 * with a tenant key, and system-scoped keys are not available for this entity.
 */
export function resolveSystemEmailDeliveryMode(payload: ResolvedEmailPayload): EmailDeliveryMode {
  if (!payload.tenantId) return 'sync'
  return payload.delivery ?? resolveConfiguredSystemEmailDeliveryMode()
}

export function resetSystemEmailDeliveryModeWarningForTests(): void {
  warnedUnknownMode = false
}
