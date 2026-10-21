import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runLedgerAction } from '../../../ledgerAction'
import { createApPaymentSchema } from '../../../../data/validators'
import '../../../../commands/ap'

export const metadata = {
  path: '/financial/ap/payments/post',
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

export async function POST(req: Request) {
  return runLedgerAction({
    req,
    schema: createApPaymentSchema,
    commandId: 'financial.ap_payments.create',
    resourceKind: 'financial:ap_payment',
    resolveResourceId: (input) => input.vendorId,
    fallbackError: 'Unable to record the vendor payment',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Record a vendor payment',
  methods: {
    POST: {
      summary: 'Record a payment, allocate it, and post it to the ledger',
      requestBody: { contentType: 'application/json', schema: createApPaymentSchema },
      responses: [{ status: 200, description: 'Payment recorded', schema: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }) }],
    },
  },
}
