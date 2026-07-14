import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  path: '/directory/tenants/lookup',
  GET: {
    requireAuth: false,
  },
}

const tenantLookupQuerySchema = z.object({
  tenantId: z.string().uuid(),
})

// Unauthenticated login/onboarding resolver: it returns the tenant name to anyone
// holding the id, so cap probes per IP to keep name-harvesting from leaked ids —
// and the unauthenticated DB query behind it — bounded and noisy.
//
// The cap is deliberately generous: the login screen resolves the tenant on every
// render and a workforce behind one NAT egress IP shares this budget, while a
// tripped lookup renders as an invalid tenant. 60/min/IP stays clear of that.
// Tune per deployment with RATE_LIMIT_DIRECTORY_TENANT_LOOKUP_POINTS / _DURATION /
// _BLOCK_DURATION.
const tenantLookupIpRateLimitConfig = readEndpointRateLimitConfig('DIRECTORY_TENANT_LOOKUP', {
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'directory-tenant-lookup',
})

export async function GET(req: Request) {
  // Consume the limit before validation or DB work, so junk input cannot bypass it.
  const rateLimiterService = getCachedRateLimiterService()
  const clientIp = rateLimiterService ? getClientIp(req, rateLimiterService.trustProxyDepth) : null
  if (rateLimiterService && clientIp) {
    const { translate } = await resolveTranslations()
    const rateLimitResponse = await checkRateLimit(
      rateLimiterService,
      tenantLookupIpRateLimitConfig,
      clientIp,
      translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
    )
    if (rateLimitResponse) return rateLimitResponse
  }

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') || url.searchParams.get('tenant') || ''
  const parsed = tenantLookupQuerySchema.safeParse({ tenantId })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid tenant id.' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager)
  const tenant = await em.findOne(Tenant, { id: parsed.data.tenantId, deletedAt: null })
  if (!tenant) {
    return NextResponse.json({ ok: false, error: 'Tenant not found.' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    tenant: { id: String(tenant.id), name: tenant.name },
  })
}

const lookupTag = 'Directory'

const tenantLookupSuccessSchema = z.object({
  ok: z.literal(true),
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
})

const tenantLookupErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const tenantLookupDoc: OpenApiMethodDoc = {
  summary: 'Public tenant lookup',
  description: 'Resolves tenant metadata for login/activation flows.',
  tags: [lookupTag],
  query: tenantLookupQuerySchema,
  responses: [
    { status: 200, description: 'Tenant resolved.', schema: tenantLookupSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid tenant id', schema: tenantLookupErrorSchema },
    { status: 404, description: 'Tenant not found', schema: tenantLookupErrorSchema },
    { status: 429, description: 'Too many tenant lookups', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: lookupTag,
  summary: 'Public tenant lookup',
  methods: {
    GET: tenantLookupDoc,
  },
}

export default GET
