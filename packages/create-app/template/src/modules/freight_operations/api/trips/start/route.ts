import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { tripActionSchema } from '../../../data/validators'
import { FREIGHT_TRIP_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/trips/start',
  POST: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ tripId: string }>(req, {
    parse: (raw) => tripActionSchema.parse(raw),
    resourceKind: FREIGHT_TRIP_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.trips.start',
    errorMessageKey: 'trip_action_failed',
    errorFallback: 'Unable to start the trip.',
    toResponse: (result) => ({ tripId: result.tripId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Start a freight trip',
  methods: {
    POST: {
      summary: 'Move the trip to in transit and stamp the actual start',
      requestBody: { contentType: 'application/json', schema: tripActionSchema },
      responses: [{ status: 200, description: 'Trip started', schema: z.object({ ok: z.boolean(), tripId: z.string().uuid() }) }],
    },
  },
}
