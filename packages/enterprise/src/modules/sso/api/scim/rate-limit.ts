import type { CacheStrategy } from '@open-mercato/cache'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readEndpointRateLimitConfig, readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { buildScimError, scimJson } from '../../lib/scim-response'
import { readScimAdmissionKey } from '../../lib/scim-admission-cache'

const admissions = new WeakMap<Request, Promise<Response | null>>()

export function checkScimRateLimit(req: Request): Promise<Response | null> {
  const existing = admissions.get(req)
  if (existing) return existing
  const admission = consumeScimRateLimit(req)
  admissions.set(req, admission)
  return admission
}

async function consumeScimRateLimit(req: Request): Promise<Response | null> {
  let limited: Response | null = new Response(null, { status: 503 })
  try {
    if (!readRateLimitConfig().enabled) return null
    const limiter = getCachedRateLimiterService()
    const config = readEndpointRateLimitConfig('SCIM', {
      points: 10,
      duration: 1,
      keyPrefix: 'sso-scim',
    })
    if (limiter) {
      const key = await resolveScimRateLimitKey(req, getClientIp(req, limiter.trustProxyDepth))
      limited = await checkRateLimit(limiter, config, key, RATE_LIMIT_ERROR_FALLBACK, { failClosed: true })
    }
  } catch (error) {
    try {
      getTelemetryRuntime()?.reportError(error, { module: 'sso', code: 'sso.scim_admission_unavailable' })
    } catch {
      return buildScimRateLimitResponse(new Response(null, { status: 503 }))
    }
  }
  if (!limited) return null
  return buildScimRateLimitResponse(limited)
}

async function buildScimRateLimitResponse(limited: Response): Promise<Response> {
  const { translate } = await resolveTranslations()
  const detail = limited.status === 429
    ? translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)
    : translate(RATE_LIMIT_UNAVAILABLE_KEY, RATE_LIMIT_UNAVAILABLE_FALLBACK)
  const response = scimJson(buildScimError(limited.status, detail), limited.status)
  limited.headers.forEach((value, name) => {
    if (name !== 'content-type') response.headers.set(name, value)
  })
  return response
}

async function resolveScimRateLimitKey(req: Request, clientIp: string | null): Promise<string> {
  if (new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/sso/scim/v2/ServiceProviderConfig')) {
    return `discovery:${clientIp ?? RATE_LIMIT_FALLBACK_KEY}`
  }
  const authorization = req.headers.get('authorization')
  const rawToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (/^omscim_[0-9a-f]{64}$/.test(rawToken)) {
    const container = await createRequestContainer()
    const cache = container.resolve<CacheStrategy>('cache')
    const verifiedKey = await readScimAdmissionKey(cache, rawToken)
    if (verifiedKey) return verifiedKey
  }
  return clientIp ?? RATE_LIMIT_FALLBACK_KEY
}
