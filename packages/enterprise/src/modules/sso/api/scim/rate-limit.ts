import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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
import { ScimToken } from '../../data/entities'

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
  if (clientIp) return clientIp

  const authorization = req.headers.get('authorization')
  const rawToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!/^omscim_[0-9a-f]{64}$/.test(rawToken)) return RATE_LIMIT_FALLBACK_KEY

  const tokenPrefix = rawToken.slice(0, 12)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const activeToken = await findOneWithDecryption(em, ScimToken, { tokenPrefix, isActive: true }, { fields: ['id'] })
  return activeToken
    ? `token:${createHash('sha256').update(tokenPrefix).digest('hex')}`
    : RATE_LIMIT_FALLBACK_KEY
}
