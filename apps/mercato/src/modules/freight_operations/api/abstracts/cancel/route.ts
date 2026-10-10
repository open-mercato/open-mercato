import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractCancelSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/cancel',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string }>(req, {
    parse: (raw) => abstractCancelSchema.parse(raw),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.cancel',
    errorMessageKey: 'abstract_cancel_failed',
    errorFallback: 'Unable to cancel the abstract.',
    toResponse: (result) => ({ abstractId: result.abstractId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Cancel a trip abstract before it is invoiced',
  methods: {
    POST: {
      summary: 'Void the abstract, release its trips for billing again, and record the reason',
      requestBody: { contentType: 'application/json', schema: abstractCancelSchema },
      responses: [
        {
          status: 200,
          description: 'Abstract cancelled',
          schema: z.object({ ok: z.boolean(), abstractId: z.string().uuid() }),
        },
      ],
    },
  },
}
