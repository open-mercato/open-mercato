import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { invoiceRentalSchema } from '../../../data/validators'
import { RENTAL_CONTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeRentalAction } from '../../../lib/apiAction'
import '../../../commands/invoice'

export const metadata = {
  path: '/vehicle_rentals/contracts/invoice',
  POST: { requireAuth: true, requireFeatures: ['rentals.manage'] },
}

export async function POST(req: Request) {
  return executeRentalAction<{ rentalId: string; salesOrderId: string; salesInvoiceId: string }>(req, {
    parse: (raw) => invoiceRentalSchema.parse(raw),
    resourceKind: RENTAL_CONTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'vehicle_rentals.contracts.invoice',
    errorMessageKey: 'invoice_failed',
    errorFallback: 'Unable to invoice the rental.',
    toResponse: (result) => ({
      rentalId: result.rentalId,
      salesOrderId: result.salesOrderId,
      salesInvoiceId: result.salesInvoiceId,
    }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Invoice a completed rental',
  methods: {
    POST: {
      summary: 'Creates the sales order and invoice for the completed rental once; retries return the same invoice',
      requestBody: { contentType: 'application/json', schema: invoiceRentalSchema },
      responses: [{
        status: 200,
        description: 'Rental invoiced',
        schema: z.object({
          ok: z.boolean(),
          rentalId: z.string().uuid(),
          salesOrderId: z.string().uuid(),
          salesInvoiceId: z.string().uuid(),
        }),
      }],
      errors: [
        { status: 409, description: 'Rental is not completed or has no billable amount' },
        { status: 500, description: 'Sales bridge failed' },
      ],
    },
  },
}
