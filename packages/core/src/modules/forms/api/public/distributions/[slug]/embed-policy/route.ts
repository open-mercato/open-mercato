/**
 * Public runtime API — GET /api/forms/public/distributions/:slug/embed-policy
 *
 * Returns the `frame-ancestors` CSP directive authorizing which third-party
 * origins may frame the `/embed/:slug` host page (forms render-surfaces spec
 * `2026-05-21-forms-render-surfaces.md`, S4 / D6 / R-RS-1). Consumed server-side
 * by the app `/embed` middleware to set a dynamic, per-distribution framing
 * header. Unauthenticated by design — the value it returns is the same
 * allowlist the browser enforces and exposes to the framing site anyway.
 *
 * Fails closed: a non-embeddable / unknown slug yields `frame-ancestors 'none'`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DistributionService } from '../../../../../services/distribution-service'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  _req: NextRequest,
  context: { params: { slug: string } | Promise<{ slug: string }> },
) {
  const params = await Promise.resolve(context.params)
  const slug = String(params.slug)

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
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public distribution embed framing policy',
  methods: { GET: getMethodDoc },
}
