import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { returnRentalSchema } from '../../../data/validators'
import { RENTAL_CONTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeRentalAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/vehicle_rentals/contracts/return',
  POST: { requireAuth: true, requireFeatures: ['rentals.handover'] },
}

export async function POST(req: Request) {
  return executeRentalAction<{ rentalId: string }>(req, {
    parse: (raw) => returnRentalSchema.parse(raw),
    resourceKind: RENTAL_CONTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'vehicle_rentals.contracts.return',
    errorMessageKey: 'return_failed',
    errorFallback: 'Unable to return the vehicle.',
    toResponse: (result) => ({ rentalId: result.rentalId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Return a rental vehicle',
  methods: {
    POST: {
      summary: 'Closes the rental: records the return check, the extra kilometres and the final amounts',
      requestBody: { contentType: 'application/json', schema: returnRentalSchema },
      responses: [{
        status: 200,
        description: 'Rental returned',
        schema: z.object({ ok: z.boolean(), rentalId: z.string().uuid() }),
      }],
    },
  },
}
