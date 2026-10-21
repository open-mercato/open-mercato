import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runLedgerAction } from '../../ledgerAction'
import '../../../commands/bank'

export const metadata = {
  path: '/financial/bank-statements/match',
  POST: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runLedgerAction({
    req,
    schema,
    commandId: 'financial.bank_statements.match',
    resourceKind: 'financial:gl_bank_statement',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to match the statement',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Match a bank statement',
  methods: {
    POST: {
      summary: 'Match imported lines to posted cash/bank ledger lines',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Match result', schema: z.object({ matched: z.number(), unmatched: z.number() }) }],
    },
  },
}
