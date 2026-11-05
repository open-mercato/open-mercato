import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: {
    requireAuth: false,
    rateLimit: { points: 3, duration: 60, keyPrefix: 'ratelimit_probe' },
  },
}

export async function POST() {
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'RateLimitProbe',
  methods: {
    POST: {
      summary: 'Test-only endpoint with per-route metadata.rateLimit — used to prove rate-limit leakage under OM_INTEGRATION_TEST',
      tags: ['RateLimitProbe'],
      responses: [
        {
          status: 200,
          description: 'Always OK when under the points budget',
          schema: z.object({ ok: z.literal(true) }),
        },
        {
          status: 429,
          description: 'Rate limit exceeded (3 points / 60 s per client IP)',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
