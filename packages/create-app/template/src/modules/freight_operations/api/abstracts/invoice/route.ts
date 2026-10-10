import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractInvoiceSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/invoice',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.invoice'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{
    abstractId: string
    salesOrderId: string
    salesInvoiceId: string
    salesInvoiceNumber: string | null
  }>(req, {
    parse: (raw) => abstractInvoiceSchema.parse(raw),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.invoice',
    errorMessageKey: 'abstract_invoice_failed',
    errorFallback: 'Unable to invoice the abstract.',
    toResponse: (result) => ({
      abstractId: result.abstractId,
      salesOrderId: result.salesOrderId,
      salesInvoiceId: result.salesInvoiceId,
      salesInvoiceNumber: result.salesInvoiceNumber,
    }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Issue a VAT invoice for an approved trip abstract',
  methods: {
    POST: {
      summary: 'Create the sales order + invoice pair for the abstract through the sales ledger and lock its trips',
      requestBody: { contentType: 'application/json', schema: abstractInvoiceSchema },
      responses: [
        {
          status: 200,
          description: 'Invoice issued',
          schema: z.object({
            ok: z.boolean(),
            abstractId: z.string().uuid(),
            salesOrderId: z.string().uuid(),
            salesInvoiceId: z.string().uuid(),
            salesInvoiceNumber: z.string().nullable(),
          }),
        },
      ],
    },
  },
}
