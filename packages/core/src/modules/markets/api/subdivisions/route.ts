import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getSubdivisions } from '@open-mercato/shared/lib/location/subdivisions'
import { subdivisionsQuerySchema } from '../../data/validators'
import { marketsTag, subdivisionsResponseSchema, marketsErrorSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['markets.view'] },
} as const

/**
 * Read only, served from the static table with no database access.
 *
 * At most 56 rows for the one seeded country, so there is no pagination and `pageSize` does not
 * apply. The payload is a build-time constant, which is what makes the long cache header safe.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = subdivisionsQuerySchema.safeParse({ countryCode: url.searchParams.get('countryCode') ?? '' })
  if (!parsed.success) {
    return Response.json({ error: 'countryCode must be a known two-letter country code' }, { status: 400 })
  }

  return Response.json(
    { items: getSubdivisions(parsed.data.countryCode) },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  )
}

export const openApi: OpenApiRouteDoc = {
  tag: marketsTag,
  summary: 'Country subdivisions',
  methods: {
    GET: {
      summary: 'List the subdivisions of a country',
      description:
        'Static, organization independent reference data. Returns the 50 US states plus DC and five territories for `US`, and an empty list for a country with no seeded list. At most 56 rows, so pagination does not apply.',
      responses: [{ status: 200, description: 'The subdivision list', schema: subdivisionsResponseSchema }],
      errors: [
        { status: 400, description: 'Unknown or missing countryCode', schema: marketsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: marketsErrorSchema },
      ],
    },
  },
}
