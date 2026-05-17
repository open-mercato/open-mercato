import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import { secretEqual } from '@open-mercato/core/modules/customer_accounts/lib/secretCompare'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

const ORIGIN_HEADER_NAME = process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin'

export const metadata = {
  GET: { requireAuth: false },
}

function withOriginHeader(response: NextResponse): NextResponse {
  response.headers.set(ORIGIN_HEADER_NAME, '1')
  return response
}

export async function GET(req: Request) {
  const expected = process.env.DOMAIN_RESOLVE_SECRET
  if (!expected) {
    // Fail closed when the gating secret is not configured on the server.
    return withOriginHeader(
      NextResponse.json(
        { ok: false, error: 'DOMAIN_RESOLVE_SECRET is not configured on the server' },
        { status: 503 },
      ),
    )
  }
  const supplied = req.headers.get('x-domain-resolve-secret')
  if (!secretEqual(supplied, expected)) {
    return withOriginHeader(NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }))
  }

  const url = new URL(req.url)
  const rawHost = url.searchParams.get('host')
  if (!rawHost) return withOriginHeader(NextResponse.json({ ok: false, error: 'host param required' }, { status: 400 }))
  const hostname = tryNormalizeHostname(rawHost)
  if (!hostname) return withOriginHeader(NextResponse.json({ ok: false, error: 'invalid host' }, { status: 400 }))

  const container = await createRequestContainer()
  const service = container.resolve('domainMappingService') as DomainMappingService
  const result = await service.resolveByHostname(hostname)
  if (!result || result.status !== 'active') {
    return withOriginHeader(NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 }))
  }

  return withOriginHeader(
    NextResponse.json({
      ok: true,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      orgSlug: result.orgSlug,
      status: result.status,
    }),
  )
}

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'Resolve a custom domain to its tenant and organization',
  methods: {
    GET: {
      summary: 'Single-host resolve for the Node middleware',
      description:
        'Internal endpoint used by the portal middleware to populate its in-memory cache. Requires X-Domain-Resolve-Secret header.',
      responses: [
        {
          status: 200,
          description: 'OK',
          schema: z.object({
            ok: z.literal(true),
            tenantId: z.string().uuid(),
            organizationId: z.string().uuid(),
            orgSlug: z.string().nullable(),
            status: z.literal('active'),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 404, description: 'Not found', schema: errorSchema },
        { status: 503, description: 'Server misconfiguration', schema: errorSchema },
      ],
    },
  },
}
