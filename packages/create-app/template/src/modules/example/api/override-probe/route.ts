import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { exampleTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET() {
  return Response.json({
    ok: true,
    source: 'base',
    route: 'example.override-probe',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  methods: {
    GET: {
      summary: 'Example override probe',
      description: 'Returns a small payload used by integration tests to verify modules.ts API route overrides.',
      tags: [exampleTag],
      responses: [
        {
          status: 200,
          description: 'Probe payload',
          schema: z.object({
            ok: z.boolean(),
            source: z.string(),
            route: z.string(),
          }),
        },
      ],
    },
  },
}

