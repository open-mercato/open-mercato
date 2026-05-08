import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
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

  const container = await createRequestContainer()
  const service = container.resolve('domainMappingService') as DomainMappingService
  const records = await service.resolveAll()
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
        { status: 503, description: 'Server misconfiguration', schema: errorSchema },
      ],
    },
  },
}
