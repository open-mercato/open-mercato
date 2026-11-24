import type { SubscriberContext } from '@open-mercato/events/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { signInEventSchema } from '../data/sign-in-activity-validators'
import type { SignInResult } from '../data/entities'
import type { SignInActivityService } from '../services/SignInActivityService'
import { readSignInActivityConfig } from './sign-in-activity-config'

const logger = createLogger('security.sign-in-activity')

export async function recordSignInEvent(result: SignInResult, payload: unknown, context: SubscriberContext) {
  if (!readSignInActivityConfig().enabled) return
  const parsed = signInEventSchema.safeParse(payload)
  if (!parsed.success) {
    const error = new Error('[internal] Sign-in event is missing a valid identity or payload')
    const code = 'security.sign_in_invalid_event'
    logger.warn('Skipping invalid sign-in event', { code, result })
    getTelemetryRuntime()?.reportError(error, { module: 'security', code })
    return
  }
  const data = parsed.data
  const tenantId = context.tenantId
  const organizationId = context.organizationId ?? null
  const userId = result === 'success' ? data.id : data.userId
  if (!tenantId || !userId) return
  if (tenantId !== data.tenantId || organizationId !== (data.organizationId ?? null)) {
    const error = new Error('[internal] Sign-in event scope does not match emitter scope')
    const code = 'security.sign_in_scope_mismatch'
    logger.warn('Skipping sign-in event with conflicting scope', { code, result })
    getTelemetryRuntime()?.reportError(error, { module: 'security', code })
    return
  }

  const service = context.resolve<SignInActivityService>('signInActivityService')
  await service.recordSignInAttempt({
    tenantId,
    organizationId,
    userId,
    attemptId: data.attemptId,
    email: data.email.trim().toLowerCase(),
    ip: data.ip ?? null,
    userAgent: data.userAgent ?? null,
    occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
    result,
    reason: result === 'failure' ? data.reason ?? null : null,
  })
}
