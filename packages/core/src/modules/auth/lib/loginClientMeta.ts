import { isIP } from 'node:net'
import type { AwilixContainer } from 'awilix'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

export function resolveLoginClientMeta(request: Request, container: AwilixContainer) {
  const rateLimiter = container.resolve<RateLimiterService>('rateLimiterService', { allowUnregistered: true })
  const clientIp = getClientIp(request, rateLimiter?.trustProxyDepth)
  return {
    ip: clientIp && isIP(clientIp) ? clientIp : null,
    userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
    occurredAt: new Date().toISOString(),
  }
}
