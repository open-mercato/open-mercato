import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { orderActionSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/invoice',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.invoice'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{
    orderId: string
    salesOrderId: string
    salesInvoiceId: string
    salesInvoiceNumber: string | null
  }>(req, {
    parse: (raw) => orderActionSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.invoice',
    errorMessageKey: 'invoice_failed',
    errorFallback: 'Unable to invoice the order.',
    toResponse: (result) => ({
      orderId: result.orderId,
      salesOrderId: result.salesOrderId,
      salesInvoiceId: result.salesInvoiceId,
      salesInvoiceNumber: result.salesInvoiceNumber,
    }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Issue a VAT invoice for a completed freight order',
  methods: {
    POST: {
      summary: 'Create the sales order + invoice pair for the order through the sales ledger',
      requestBody: { contentType: 'application/json', schema: orderActionSchema },
      responses: [
        {
          status: 200,
          description: 'Invoice issued',
          schema: z.object({
            ok: z.boolean(),
            orderId: z.string().uuid(),
            salesOrderId: z.string().uuid(),
            salesInvoiceId: z.string().uuid(),
            salesInvoiceNumber: z.string().nullable(),
          }),
        },
      ],
    },
  },
}
