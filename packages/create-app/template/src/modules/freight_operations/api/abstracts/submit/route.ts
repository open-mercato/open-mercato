import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractActionSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/submit',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.submit'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string }>(req, {
    parse: (raw) => abstractActionSchema.parse(raw),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.submit',
    errorMessageKey: 'abstract_action_failed',
    errorFallback: 'Unable to submit the abstract.',
    toResponse: (result) => ({ abstractId: result.abstractId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Submit a draft trip abstract to the customer',
  methods: {
    POST: {
      summary: 'Move the abstract to submitted so the customer can accept or dispute it',
      requestBody: { contentType: 'application/json', schema: abstractActionSchema },
      responses: [
        {
          status: 200,
          description: 'Abstract submitted',
          schema: z.object({ ok: z.boolean(), abstractId: z.string().uuid() }),
        },
      ],
    },
  },
}
