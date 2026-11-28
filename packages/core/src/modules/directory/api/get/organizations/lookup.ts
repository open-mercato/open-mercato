import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolvePortalOrganization } from '@open-mercato/core/modules/directory/lib/resolvePortalOrganization'
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
//
// The cap matches the sibling tenant lookup (60/min/IP) because the legitimate
// call pattern is the same: useTenantContext resolves the org on every portal
// page mount without caching, and a whole workforce behind one NAT egress IP —
// or one reverse proxy — shares this budget. A tripped lookup renders as a
// missing organization, so the cap must clear real portal traffic by a wide
// margin. Tune per deployment with RATE_LIMIT_DIRECTORY_ORG_LOOKUP_POINTS /
// _DURATION / _BLOCK_DURATION.
const orgLookupIpRateLimitConfig = readEndpointRateLimitConfig('DIRECTORY_ORG_LOOKUP', {
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'directory-org-lookup',
})

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
  const organization = await resolvePortalOrganization(container, parsed.data.slug, req.headers.get('host'))
  if (!organization) {
    return NextResponse.json({ ok: false, error: 'Organization not found.' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    organization: {
      id: organization.id,
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
    'Resolves organization metadata for portal flows. No authentication required, so the endpoint is rate limited per IP. An active custom-domain host scopes the lookup to its mapped organization and tenant.',
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
