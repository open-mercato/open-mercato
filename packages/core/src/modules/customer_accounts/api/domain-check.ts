import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

const ORIGIN_HEADER_NAME = process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin'

export const metadata = {
  GET: { requireAuth: false },
}

function withOriginHeader(response: NextResponse): NextResponse {
  response.headers.set(ORIGIN_HEADER_NAME, '1')
  return response
}

function unauthorized(message: string): NextResponse {
  return withOriginHeader(NextResponse.json({ ok: false, error: message }, { status: 403 }))
}

function notFound(): NextResponse {
  return withOriginHeader(NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 }))
}

function ok(): NextResponse {
  return withOriginHeader(NextResponse.json({ ok: true }))
}

export async function GET(req: Request) {
  const expected = process.env.DOMAIN_CHECK_SECRET
  if (!expected) {
    return withOriginHeader(
      NextResponse.json(
        { ok: false, error: 'DOMAIN_CHECK_SECRET is not configured on the server' },
        { status: 503 },
      ),
    )
  }
  const supplied = req.headers.get('x-domain-check-secret')
  if (!supplied || supplied !== expected) return unauthorized('Forbidden')

  const url = new URL(req.url)
  // Traefik's ForwardAuth middleware cannot template the auth URL with the
  // original Host, so it forwards the original request via X-Forwarded-Host.
  // Manual / direct callers can still pass `?host=` explicitly.
  const rawHost =
    url.searchParams.get('host') ?? req.headers.get('x-forwarded-host')
  if (!rawHost) return notFound()
  const hostname = tryNormalizeHostname(rawHost)
  if (!hostname) return notFound()

  const container = await createRequestContainer()
  const service = container.resolve('domainMappingService') as DomainMappingService
  const result = await service.isAllowedForTls(hostname)
  if (!result) return notFound()
  return ok()
}

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'Traefik domain-check gate',
  methods: {
    GET: {
      summary: 'Verify a hostname is allowed for TLS provisioning',
      description:
        'Called by Traefik before issuing a Let\'s Encrypt certificate. Requires the X-Domain-Check-Secret header to match DOMAIN_CHECK_SECRET.',
      responses: [
        { status: 200, description: 'Hostname allowed', schema: z.object({ ok: z.literal(true) }) },
      ],
      errors: [
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 404, description: 'Hostname not registered or not yet verified', schema: errorSchema },
        { status: 503, description: 'Server misconfiguration', schema: errorSchema },
      ],
    },
  },
}
