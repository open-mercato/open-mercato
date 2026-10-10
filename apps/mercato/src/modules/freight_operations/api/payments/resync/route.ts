import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { paymentSyncSchema } from '../../../data/validators'
import { FREIGHT_PAYMENT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/payments/resync',
  POST: { requireAuth: true, requireFeatures: ['freight.payments.record'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ paidTotalAmount: string; outstandingAmount: string | null; invoiceSynced: boolean }>(req, {
    parse: (raw) => paymentSyncSchema.parse(raw),
    resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
    resourceId: (input) => String(input.orderId ?? input.abstractId ?? ''),
    commandId: 'freight_operations.payments.resync',
    errorMessageKey: 'payment_resync_failed',
    errorFallback: 'Unable to resync the invoice totals.',
    toResponse: (result) => ({
      paidTotalAmount: result.paidTotalAmount,
      outstandingAmount: result.outstandingAmount,
      invoiceSynced: result.invoiceSynced,
    }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Resync the sales invoice totals from the freight payment ledger',
  methods: {
    POST: {
      summary: 'Recompute paid/outstanding from the freight ledger and write them to the sales invoice',
      requestBody: { contentType: 'application/json', schema: paymentSyncSchema },
      responses: [{
        status: 200,
        description: 'Invoice totals resynced',
        schema: z.object({
          ok: z.boolean(),
          paidTotalAmount: z.string(),
          outstandingAmount: z.string().nullable(),
          invoiceSynced: z.boolean(),
        }),
      }],
    },
  },
}
