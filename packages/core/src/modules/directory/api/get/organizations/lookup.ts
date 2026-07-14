import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  path: '/directory/organizations/lookup',
  GET: {
    requireAuth: false,
  },
}

const orgLookupQuerySchema = z.object({
  slug: z.string().min(1).max(150),
})

// Unauthenticated pre-auth portal resolver: an anonymous caller can probe any
// slug, so cap probes per IP to keep slug enumeration bounded and noisy.
const orgLookupIpRateLimitConfig = readEndpointRateLimitConfig('DIRECTORY_ORG_LOOKUP', {
  points: 20,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'directory-org-lookup',
})

// Structural contract for the OPTIONAL `domainMappingService` owned by
// `customer_accounts`. Declared locally (never imported) because
// `customer_accounts` already depends on `directory` — importing it back would
// invert the dependency and break this module's isomorphism.
type DomainTenantResolver = {
  resolveByHostname(hostname: string): Promise<{ tenantId: string; status: string } | null>
}

// A branded (custom-domain) portal host already implies a tenant, so bound the
// slug lookup to it. Returns null on the platform domain, on an unmapped or
// inactive host, and when the peer module is absent — those keep the global
// resolution the platform-domain portal bootstrap depends on. The Host header is
// caller-controlled, so this is containment for legitimate branded traffic, not
// a trust boundary; the rate limit above is what bounds enumeration.
async function resolveTenantFromHost(container: AppContainer, req: Request): Promise<string | null> {
  const host = req.headers.get('host')
  if (!host) return null
  try {
    const resolver = container.resolve('domainMappingService') as DomainTenantResolver
    const mapping = await resolver.resolveByHostname(host)
    if (!mapping || mapping.status !== 'active') return null
    return mapping.tenantId
  } catch {
    return null
  }
}

// Fail-open, like auth's checkAuthRateLimit: this resolver sits on the unauthenticated
// portal bootstrap path, so a limiter outage must degrade to unlimited lookups rather
// than 500 the portal.
async function enforceOrgLookupRateLimit(req: Request): Promise<NextResponse | null> {
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (!rateLimiterService) return null
    const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
    if (!clientIp) return null
    const { translate } = await resolveTranslations()
    return await checkRateLimit(
      rateLimiterService,
      orgLookupIpRateLimitConfig,
      clientIp,
      translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
    )
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  // Consume the limit before validation or DB work, so junk input cannot bypass it.
  const rateLimitResponse = await enforceOrgLookupRateLimit(req)
  if (rateLimitResponse) return rateLimitResponse

  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') || ''
  const parsed = orgLookupQuerySchema.safeParse({ slug })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid slug.' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const tenantId = await resolveTenantFromHost(container, req)
  // `slug` is unique per (tenant, slug), not globally, so an unscoped match can
  // hit several tenants' rows. Order deterministically so an unscoped collision
  // always resolves to the same organization instead of an arbitrary one.
  const organization = await em.findOne(
    Organization,
    {
      slug: parsed.data.slug,
      deletedAt: null,
      ...(tenantId ? { tenant: tenantId } : {}),
    },
    { orderBy: { createdAt: 'ASC' } },
  )
  if (!organization) {
    return NextResponse.json({ ok: false, error: 'Organization not found.' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    organization: {
      id: String(organization.id),
      name: organization.name,
      slug: organization.slug,
    },
  })
}

const lookupTag = 'Directory'

const orgLookupSuccessSchema = z.object({
  ok: z.literal(true),
  organization: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  }),
})

const orgLookupErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const orgLookupDoc: OpenApiMethodDoc = {
  summary: 'Public organization lookup by slug',
  description:
    'Resolves organization metadata for portal flows. No authentication required, so the endpoint is rate limited per IP. On a custom-domain host the lookup is scoped to that host\'s tenant.',
  tags: [lookupTag],
  query: orgLookupQuerySchema,
  responses: [
    { status: 200, description: 'Organization resolved.', schema: orgLookupSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid slug', schema: orgLookupErrorSchema },
    { status: 404, description: 'Organization not found', schema: orgLookupErrorSchema },
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: lookupTag,
  summary: 'Public organization lookup by slug',
  methods: {
    GET: orgLookupDoc,
  },
}

export default GET
