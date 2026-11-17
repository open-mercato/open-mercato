/**
 * Public runtime API — GET /api/forms/public/distributions/:slug/embed-policy
 *
 * Returns the `frame-ancestors` CSP directive authorizing which third-party
 * origins may frame the `/embed/:slug` host page (forms render-surfaces spec
 * `2026-05-21-forms-render-surfaces.md`, S4 / D6 / R-RS-1). Unauthenticated by
 * design — the value it returns is the same allowlist the browser enforces and
 * exposes to the framing site anyway.
 *
 * Fails closed: a non-embeddable / unknown slug yields `frame-ancestors 'none'`.
 *
 * NOTE: this endpoint is currently unconsumed. It is designed to be read
 * server-side by an app-level `/embed` proxy branch that sets the per-request
 * framing header, and that branch does not exist in this repo — see
 * `frontend/embed/[slug]/page.meta.ts` for why and what it would take. Until it
 * lands, the app's global `frame-ancestors 'self'` blocks cross-origin framing
 * of `/embed/:slug` outright, so the surface is safe but inert.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DistributionService } from '../../../../../services/distribution-service'
import { buildPublicRateLimitKey, enforcePublicRateLimit } from '../../../rate-limit'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { slug: string } | Promise<{ slug: string }> },
) {
  const params = await Promise.resolve(context.params)
  const slug = String(params.slug)

  const limited = await enforcePublicRateLimit(
    req,
    buildPublicRateLimitKey('embed-policy', slug),
  )
  if (limited) return limited

  const container = await createRequestContainer()
  const service = container.resolve('formsDistributionService') as DistributionService

  const { frameAncestors, embeddable } = await service.getEmbedPolicyBySlug(slug)
  return NextResponse.json(
    { frame_ancestors: frameAncestors, embeddable },
    { headers: { 'cache-control': 'public, max-age=60' } },
  )
}

const responseSchema = z.object({
  frame_ancestors: z.string(),
  embeddable: z.boolean(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Resolve the embed framing policy for a distribution',
  description:
    'Returns the Content-Security-Policy frame-ancestors directive authorizing which origins may frame the /embed/:slug host page. Fails closed to frame-ancestors none for non-embeddable or unknown distributions.',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'Embed framing policy', schema: responseSchema }],
  errors: [
    { status: 429, description: 'Rate limit exceeded' },
    { status: 503, description: 'Rate limiting unavailable' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public distribution embed framing policy',
  methods: { GET: getMethodDoc },
}
