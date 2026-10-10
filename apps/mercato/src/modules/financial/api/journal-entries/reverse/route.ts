import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FINANCIAL_ENTRY_ENTITY_ID, reverseJournalEntrySchema } from '../../../commands/ledger'
import '../../../commands/ledger'
import { runLedgerAction } from '../../ledgerAction'

export const metadata = {
  path: '/financial/journal-entries/reverse',
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

type ReverseResult = { id: string; originalId: string; updatedAt: string }

export async function POST(req: Request) {
  return runLedgerAction<z.infer<typeof reverseJournalEntrySchema>, ReverseResult>({
    req,
    schema: reverseJournalEntrySchema,
    commandId: 'financial.journal_entries.reverse',
    resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to reverse the journal entry',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Reverse a journal entry',
  methods: {
    POST: {
      summary: 'Create the mirror entry that cancels a posted entry',
      description:
        'Only a posted entry can be reversed. The reversal is a new posted entry with debits and credits swapped, linked to the original, which is marked reversed.',
      requestBody: { contentType: 'application/json', schema: reverseJournalEntrySchema },
      responses: [
        {
          status: 200,
          description: 'Entry reversed',
          schema: z.object({
            id: z.string().uuid(),
            originalId: z.string().uuid(),
            updatedAt: z.string(),
          }),
        },
      ],
    },
  },
}
