import { createHash } from 'node:crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_UNAVAILABLE_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { MfaProviderRuntimeContext } from './mfa-provider-interface'

export async function limitOtpEmailSetup(userId: string, email: string, context?: MfaProviderRuntimeContext): Promise<void> {
  if (!context?.request) return
  const { translate } = await resolveTranslations()
  const commandContext = context.commandContext
  const auth = commandContext?.auth
  if (!commandContext || !auth?.tenantId || auth.sub !== userId) throw new CrudHttpError(403, { error: translate('api.errors.forbidden') })
  let limiter: RateLimiterService
  try {
    limiter = commandContext.container.resolve<RateLimiterService>('rateLimiterService')
  } catch {
    throw new CrudHttpError(503, { error: translate(RATE_LIMIT_UNAVAILABLE_KEY) })
  }
  const destination = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  const ip = getClientIp(context.request, limiter.trustProxyDepth)
  const buckets = [
    { key: ['user', auth.tenantId, userId], points: 5 },
    { key: ['destination', auth.tenantId, destination], points: 5 },
    { key: ip ? ['ip', auth.tenantId, ip] : ['request', auth.tenantId, userId], points: 20 },
  ]
  for (const bucket of buckets) {
    const result = await limiter.consume(JSON.stringify(bucket.key), { points: bucket.points, duration: 600, keyPrefix: 'security_mfa_email_setup' })
    if (result.degraded) throw new CrudHttpError(503, { error: translate(RATE_LIMIT_UNAVAILABLE_KEY) })
    if (!result.allowed) throw new CrudHttpError(429, { error: translate(RATE_LIMIT_ERROR_KEY) })
  }
}
