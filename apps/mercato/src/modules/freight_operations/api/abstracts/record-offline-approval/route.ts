import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractOfflineApprovalSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/record-offline-approval',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.record_offline_approval'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string }>(req, {
    parse: (raw) => abstractOfflineApprovalSchema.parse(raw),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.record_offline_approval',
    errorMessageKey: 'abstract_approval_failed',
    errorFallback: 'Unable to record the offline approval.',
    toResponse: (result) => ({ abstractId: result.abstractId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Record an offline customer approval of a trip abstract',
  methods: {
    POST: {
      summary: 'Approve a submitted abstract with the reference and note of the approval received outside the portal',
      requestBody: { contentType: 'application/json', schema: abstractOfflineApprovalSchema },
      responses: [
        {
          status: 200,
          description: 'Offline approval recorded',
          schema: z.object({ ok: z.boolean(), abstractId: z.string().uuid() }),
        },
      ],
    },
  },
}
