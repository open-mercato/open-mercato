import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runLedgerAction } from '../../../ledgerAction'
import '../../../../commands/ap'

export const metadata = {
  path: '/financial/ap/invoices/post',
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runLedgerAction({
    req,
    schema,
    commandId: 'financial.ap_vendor_invoices.post',
    resourceKind: 'financial:ap_vendor_invoice',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to post the vendor invoice',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Post a vendor invoice',
  methods: {
    POST: {
      summary: 'Post a draft vendor invoice to the ledger',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Posted', schema: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }) }],
    },
  },
}
