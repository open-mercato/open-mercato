import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { voidPaymentSchema } from '../../../data/validators'
import { FREIGHT_PAYMENT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/payments/void',
  POST: { requireAuth: true, requireFeatures: ['freight.payments.record'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ paymentId: string; invoiceSynced: boolean }>(req, {
    parse: (raw) => voidPaymentSchema.parse(raw),
    resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.payments.void',
    errorMessageKey: 'payment_void_failed',
    errorFallback: 'Unable to void the payment.',
    toResponse: (result) => ({ paymentId: result.paymentId, invoiceSynced: result.invoiceSynced }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Void a recorded freight payment',
  methods: {
    POST: {
      summary: 'Void the payment, remove it from the sales ledger, and resync the invoice totals',
      requestBody: { contentType: 'application/json', schema: voidPaymentSchema },
      responses: [{
        status: 200,
        description: 'Payment voided',
        schema: z.object({ ok: z.boolean(), paymentId: z.string().uuid(), invoiceSynced: z.boolean() }),
      }],
    },
  },
}
