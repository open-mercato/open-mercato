import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runLedgerAction } from '../../../ledgerAction'
import '../../../../commands/ap'

export const metadata = {
  path: '/financial/ap/payments/void',
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runLedgerAction({
    req,
    schema,
    commandId: 'financial.ap_payments.void',
    resourceKind: 'financial:ap_payment',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to void the vendor payment',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Void a vendor payment',
  methods: {
    POST: {
      summary: 'Reverse a posted vendor payment',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Voided', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
