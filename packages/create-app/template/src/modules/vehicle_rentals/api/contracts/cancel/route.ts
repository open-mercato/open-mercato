import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cancelRentalSchema } from '../../../data/validators'
import { RENTAL_CONTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeRentalAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/vehicle_rentals/contracts/cancel',
  POST: { requireAuth: true, requireFeatures: ['rentals.manage'] },
}

export async function POST(req: Request) {
  return executeRentalAction<{ rentalId: string }>(req, {
    parse: (raw) => cancelRentalSchema.parse(raw),
    resourceKind: RENTAL_CONTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'vehicle_rentals.contracts.cancel',
    errorMessageKey: 'cancel_failed',
    errorFallback: 'Unable to cancel the rental.',
    toResponse: (result) => ({ rentalId: result.rentalId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Cancel a rental contract',
  methods: {
    POST: {
      summary: 'Cancels a draft or active rental',
      requestBody: { contentType: 'application/json', schema: cancelRentalSchema },
      responses: [{
        status: 200,
        description: 'Rental cancelled',
        schema: z.object({ ok: z.boolean(), rentalId: z.string().uuid() }),
      }],
    },
  },
}
