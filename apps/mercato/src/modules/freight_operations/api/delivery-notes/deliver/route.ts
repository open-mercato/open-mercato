import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { deliverDeliveryNoteSchema } from '../../../data/validators'
import { FREIGHT_DELIVERY_NOTE_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/delivery-notes/deliver',
  POST: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ deliveryNoteId: string }>(req, {
    parse: (raw) => deliverDeliveryNoteSchema.parse(raw),
    resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.delivery_notes.deliver',
    errorMessageKey: 'deliver_failed',
    errorFallback: 'Unable to record the delivery note receipt.',
    toResponse: (result) => ({ deliveryNoteId: result.deliveryNoteId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Record the delivery note receipt',
  methods: {
    POST: {
      summary: 'Record the consignee, POD/POP reference or document, and mark the note delivered',
      requestBody: { contentType: 'application/json', schema: deliverDeliveryNoteSchema },
      responses: [
        {
          status: 200,
          description: 'Delivery recorded',
          schema: z.object({ ok: z.boolean(), deliveryNoteId: z.string().uuid() }),
        },
      ],
    },
  },
}
