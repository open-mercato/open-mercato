import type { AwilixContainer } from 'awilix'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

export function resolveLoginClientMeta(request: Request, container: AwilixContainer) {
  const rateLimiter = container.resolve<RateLimiterService>('rateLimiterService', { allowUnregistered: true })
  return {
    ip: getClientIp(request, rateLimiter?.trustProxyDepth),
    userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
    occurredAt: new Date().toISOString(),
  }
}
