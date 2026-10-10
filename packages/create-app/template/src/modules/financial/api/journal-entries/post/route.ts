import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FINANCIAL_ENTRY_ENTITY_ID, postJournalEntrySchema } from '../../../commands/ledger'
import '../../../commands/ledger'
import { runLedgerAction } from '../../ledgerAction'

export const metadata = {
  path: '/financial/journal-entries/post',
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

type PostResult = { id: string; status: string; updatedAt: string }

export async function POST(req: Request) {
  return runLedgerAction<z.infer<typeof postJournalEntrySchema>, PostResult>({
    req,
    schema: postJournalEntrySchema,
    commandId: 'financial.journal_entries.post',
    resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to post the journal entry',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Post a journal entry',
  methods: {
    POST: {
      summary: 'Freeze a draft journal entry into the ledger',
      description:
        'Posts a draft entry. Refused when the entry is not a draft, when the target period is closed, or when the entry no longer balances. Carries the optimistic-lock header, so a stale updatedAt returns 409.',
      requestBody: { contentType: 'application/json', schema: postJournalEntrySchema },
      responses: [
        {
          status: 200,
          description: 'Entry posted',
          schema: z.object({ id: z.string().uuid(), status: z.string(), updatedAt: z.string() }),
        },
      ],
    },
  },
}
