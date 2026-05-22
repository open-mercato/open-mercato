import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { secretEqual } from '@open-mercato/core/modules/customer_accounts/lib/secretCompare'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  domainResolveAllIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'

const ORIGIN_HEADER_NAME = process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin'
const LOG_PREFIX = '[domain-resolve/all]'
const ENDPOINT_PATH = '/api/customer_accounts/domain-resolve/all'

export const metadata = {
  GET: { requireAuth: false },
}

function withOriginHeader(response: NextResponse): NextResponse {
  response.headers.set(ORIGIN_HEADER_NAME, '1')
  return response
}

function readCallerIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp && realIp.trim().length > 0) return realIp.trim()
  return 'unknown'
}

export async function GET(req: Request) {
  const callerIp = readCallerIp(req)
  const expected = process.env.DOMAIN_RESOLVE_SECRET
  if (!expected) {
    // Fail closed when the gating secret is not configured on the server.
    console.warn(`${LOG_PREFIX} rejected request — secret not configured`, {
      endpoint: ENDPOINT_PATH,
      ip: callerIp,
      outcome: 'misconfigured',
    })
    return withOriginHeader(
      NextResponse.json(
        { ok: false, error: 'DOMAIN_RESOLVE_SECRET is not configured on the server' },
        { status: 503 },
      ),
    )
  }

  // Rate-limit by caller IP before the secret comparison to make leak-driven
  // enumeration noisy and bounded. Fails closed (returns the helper's 429
  // response) when the limit is exceeded.
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: domainResolveAllIpRateLimitConfig,
  })
  if (rateLimitError) {
    console.warn(`${LOG_PREFIX} rate-limited`, {
      endpoint: ENDPOINT_PATH,
      ip: callerIp,
      outcome: 'rate_limited',
    })
    return withOriginHeader(rateLimitError)
  }

  const supplied = req.headers.get('x-domain-resolve-secret')
  if (!secretEqual(supplied, expected)) {
    console.warn(`${LOG_PREFIX} rejected request — invalid secret`, {
      endpoint: ENDPOINT_PATH,
      ip: callerIp,
      outcome: 'forbidden',
    })
    return withOriginHeader(NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }))
  }

  const container = await createRequestContainer()
  const service = container.resolve('domainMappingService') as DomainMappingService
  const records = await service.resolveAll()
  console.info(`${LOG_PREFIX} authorized`, {
    endpoint: ENDPOINT_PATH,
    ip: callerIp,
    outcome: 'ok',
    domains: records.length,
  })
  return withOriginHeader(
    NextResponse.json({
      ok: true,
      domains: records.map((r) => ({
        hostname: r.hostname,
        tenantId: r.tenantId,
        organizationId: r.organizationId,
        orgSlug: r.orgSlug,
        status: r.status,
      })),
    }),
  )
}

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'Batch resolve all active custom domains',
  methods: {
    GET: {
      summary: 'Batch warm-up for the Node middleware',
      description:
        'Returns every active domain mapping in a single payload so the middleware can populate its cache on process start. Requires X-Domain-Resolve-Secret header.',
      responses: [
        {
          status: 200,
          description: 'OK',
          schema: z.object({
            ok: z.literal(true),
            domains: z.array(
              z.object({
                hostname: z.string(),
                tenantId: z.string().uuid(),
                organizationId: z.string().uuid(),
                orgSlug: z.string().nullable(),
                status: z.literal('active'),
              }),
            ),
          }),
        },
      ],
      errors: [
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
        { status: 503, description: 'Server misconfiguration', schema: errorSchema },
      ],
    },
  },
}
