import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cancelDeliveryNoteSchema } from '../../../data/validators'
import { FREIGHT_DELIVERY_NOTE_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/delivery-notes/cancel',
  POST: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ deliveryNoteId: string }>(req, {
    parse: (raw) => cancelDeliveryNoteSchema.parse(raw),
    resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.delivery_notes.cancel',
    errorMessageKey: 'cancel_failed',
    errorFallback: 'Unable to cancel the delivery note.',
    toResponse: (result) => ({ deliveryNoteId: result.deliveryNoteId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Cancel a delivery note',
  methods: {
    POST: {
      summary: 'Cancel a draft or issued note; refused while an external waybill is still recorded',
      requestBody: { contentType: 'application/json', schema: cancelDeliveryNoteSchema },
      responses: [
        {
          status: 200,
          description: 'Delivery note cancelled',
          schema: z.object({ ok: z.boolean(), deliveryNoteId: z.string().uuid() }),
        },
      ],
    },
  },
}
