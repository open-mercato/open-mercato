import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { tripActionSchema } from '../../../data/validators'
import { FREIGHT_TRIP_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/trips/exclude',
  POST: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ tripId: string }>(req, {
    parse: (raw) => tripActionSchema.parse(raw),
    resourceKind: FREIGHT_TRIP_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.trips.exclude',
    errorMessageKey: 'trip_action_failed',
    errorFallback: 'Unable to exclude the trip from billing.',
    toResponse: (result) => ({ tripId: result.tripId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Exclude a freight trip from billing',
  methods: {
    POST: {
      summary: 'Permanently keep the trip out of abstracts and invoices',
      requestBody: { contentType: 'application/json', schema: tripActionSchema },
      responses: [{ status: 200, description: 'Trip excluded', schema: z.object({ ok: z.boolean(), tripId: z.string().uuid() }) }],
    },
  },
}
