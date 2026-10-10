import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FINANCIAL_PERIOD_ENTITY_ID, closePeriodSchema } from '../../../commands/ledger'
import '../../../commands/ledger'
import { runLedgerAction } from '../../ledgerAction'

export const metadata = {
  path: '/financial/periods/close',
  POST: { requireAuth: true, requireFeatures: ['financial.close'] },
}

type CloseResult = { id: string; status: string; updatedAt: string }

export async function POST(req: Request) {
  return runLedgerAction<z.infer<typeof closePeriodSchema>, CloseResult>({
    req,
    schema: closePeriodSchema,
    commandId: 'financial.periods.close',
    resourceKind: FINANCIAL_PERIOD_ENTITY_ID,
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to close the accounting period',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Close an accounting period',
  methods: {
    POST: {
      summary: 'Move a period to soft-closed or hard-closed',
      description:
        'soft_closed only from open; hard_closed only from soft_closed. A hard-closed period cannot be reopened through the API.',
      requestBody: { contentType: 'application/json', schema: closePeriodSchema },
      responses: [
        {
          status: 200,
          description: 'Period closed',
          schema: z.object({ id: z.string().uuid(), status: z.string(), updatedAt: z.string() }),
        },
      ],
    },
  },
}
