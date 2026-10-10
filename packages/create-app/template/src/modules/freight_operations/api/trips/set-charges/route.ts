import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { setTripChargesSchema } from '../../../data/validators'
import { FREIGHT_TRIP_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/trips/set-charges',
  POST: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ tripId: string }>(req, {
    parse: (raw) => setTripChargesSchema.parse(raw),
    resourceKind: FREIGHT_TRIP_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.trips.set_charges',
    errorMessageKey: 'trip_action_failed',
    errorFallback: 'Unable to save the trip charges.',
    toResponse: (result) => ({ tripId: result.tripId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Replace the extra charges on a freight trip',
  methods: {
    POST: {
      summary: 'Replace the trip charge lines and recompute the trip totals',
      requestBody: { contentType: 'application/json', schema: setTripChargesSchema },
      responses: [{ status: 200, description: 'Charges saved', schema: z.object({ ok: z.boolean(), tripId: z.string().uuid() }) }],
    },
  },
}
