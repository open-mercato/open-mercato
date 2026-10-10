import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractFinalizeSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/finalize',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.finalize'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string }>(req, {
    parse: (raw) => abstractFinalizeSchema.parse(raw),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.finalize',
    errorMessageKey: 'abstract_finalize_failed',
    errorFallback: 'Unable to finalize the abstract.',
    toResponse: (result) => ({ abstractId: result.abstractId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Finalize a trip abstract internally',
  methods: {
    POST: {
      summary: 'Approve the abstract without the customer gate, for contracts that waive it',
      requestBody: { contentType: 'application/json', schema: abstractFinalizeSchema },
      responses: [
        {
          status: 200,
          description: 'Abstract finalized',
          schema: z.object({ ok: z.boolean(), abstractId: z.string().uuid() }),
        },
      ],
    },
  },
}
