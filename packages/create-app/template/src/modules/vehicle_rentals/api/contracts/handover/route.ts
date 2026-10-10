import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { handoverRentalSchema } from '../../../data/validators'
import { RENTAL_CONTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeRentalAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/vehicle_rentals/contracts/handover',
  POST: { requireAuth: true, requireFeatures: ['rentals.handover'] },
}

export async function POST(req: Request) {
  return executeRentalAction<{ rentalId: string }>(req, {
    parse: (raw) => handoverRentalSchema.parse(raw),
    resourceKind: RENTAL_CONTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'vehicle_rentals.contracts.handover',
    errorMessageKey: 'handover_failed',
    errorFallback: 'Unable to hand over the vehicle.',
    toResponse: (result) => ({ rentalId: result.rentalId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Hand a rental vehicle over to the customer',
  methods: {
    POST: {
      summary: 'Opens the rental: records the handover check and marks the contract active',
      requestBody: { contentType: 'application/json', schema: handoverRentalSchema },
      responses: [{
        status: 200,
        description: 'Rental handed over',
        schema: z.object({ ok: z.boolean(), rentalId: z.string().uuid() }),
      }],
    },
  },
}
