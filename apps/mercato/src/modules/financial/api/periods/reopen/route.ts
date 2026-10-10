import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FINANCIAL_PERIOD_ENTITY_ID, reopenPeriodSchema } from '../../../commands/ledger'
import '../../../commands/ledger'
import { runLedgerAction } from '../../ledgerAction'

export const metadata = {
  path: '/financial/periods/reopen',
  POST: { requireAuth: true, requireFeatures: ['financial.close'] },
}

type ReopenResult = { id: string; status: string; updatedAt: string }

export async function POST(req: Request) {
  return runLedgerAction<z.infer<typeof reopenPeriodSchema>, ReopenResult>({
    req,
    schema: reopenPeriodSchema,
    commandId: 'financial.periods.reopen',
    resourceKind: FINANCIAL_PERIOD_ENTITY_ID,
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to reopen the accounting period',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Reopen an accounting period',
  methods: {
    POST: {
      summary: 'Return a soft-closed period to open',
      description: 'Only a soft-closed period can be reopened; a hard-closed period cannot.',
      requestBody: { contentType: 'application/json', schema: reopenPeriodSchema },
      responses: [
        {
          status: 200,
          description: 'Period reopened',
          schema: z.object({ id: z.string().uuid(), status: z.string(), updatedAt: z.string() }),
        },
      ],
    },
  },
}
