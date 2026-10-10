import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { tripDeliverSchema } from '../../../data/validators'
import { FREIGHT_TRIP_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/trips/deliver',
  POST: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ tripId: string }>(req, {
    parse: (raw) => tripDeliverSchema.parse(raw),
    resourceKind: FREIGHT_TRIP_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.trips.deliver',
    errorMessageKey: 'trip_action_failed',
    errorFallback: 'Unable to record the trip delivery.',
    toResponse: (result) => ({ tripId: result.tripId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Record delivery of a freight trip',
  methods: {
    POST: {
      summary: 'Move the trip to delivered with the proof-of-delivery reference',
      requestBody: { contentType: 'application/json', schema: tripDeliverSchema },
      responses: [{ status: 200, description: 'Trip delivered', schema: z.object({ ok: z.boolean(), tripId: z.string().uuid() }) }],
    },
  },
}
