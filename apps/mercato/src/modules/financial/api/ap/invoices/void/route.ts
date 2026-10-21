import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runLedgerAction } from '../../../ledgerAction'
import '../../../../commands/ap'

export const metadata = {
  path: '/financial/ap/invoices/void',
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runLedgerAction({
    req,
    schema,
    commandId: 'financial.ap_vendor_invoices.void',
    resourceKind: 'financial:ap_vendor_invoice',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to void the vendor invoice',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Void a vendor invoice',
  methods: {
    POST: {
      summary: 'Reverse a posted vendor invoice',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Voided', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
