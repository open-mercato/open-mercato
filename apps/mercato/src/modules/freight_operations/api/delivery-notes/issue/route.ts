import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { deliveryNoteActionSchema } from '../../../data/validators'
import { FREIGHT_DELIVERY_NOTE_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/delivery-notes/issue',
  POST: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ deliveryNoteId: string }>(req, {
    parse: (raw) => deliveryNoteActionSchema.parse(raw),
    resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.delivery_notes.issue',
    errorMessageKey: 'issue_failed',
    errorFallback: 'Unable to issue the delivery note.',
    toResponse: (result) => ({ deliveryNoteId: result.deliveryNoteId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Issue a delivery note',
  methods: {
    POST: {
      summary: 'Freeze the seller, driver and vehicle snapshots and issue the note',
      requestBody: { contentType: 'application/json', schema: deliveryNoteActionSchema },
      responses: [
        {
          status: 200,
          description: 'Delivery note issued',
          schema: z.object({ ok: z.boolean(), deliveryNoteId: z.string().uuid() }),
        },
      ],
    },
  },
}
