import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { routeEstimateSchema } from '../../../data/validators'
import { resolveRoutingProvider } from '../../../lib/routing'

const logger = createLogger('transport_operations')

export const metadata = {
  path: '/transport_operations/tracking/estimate',
  POST: { requireAuth: true, requireFeatures: ['transport.read'] },
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const raw = await readJsonSafe(req, {})
    const input = routeEstimateSchema.parse(raw ?? {})
    const provider = resolveRoutingProvider()
    const estimate = await provider.estimate(input.origin, input.destination)
    return NextResponse.json({ ok: true, ...estimate })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('transport_operations.route_estimate.failed', { err })
    return NextResponse.json({ error: 'Unable to estimate the route' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Transport Operations',
  summary: 'Route distance and ETA estimate',
  methods: {
    POST: {
      summary: 'Estimate the driven distance and duration between two points',
      requestBody: { contentType: 'application/json', schema: routeEstimateSchema },
      responses: [{
        status: 200,
        description: 'Distance and duration estimate',
        schema: z.object({
          ok: z.boolean(),
          distanceKm: z.number(),
          durationMinutes: z.number(),
          provider: z.string(),
        }),
      }],
    },
  },
}
