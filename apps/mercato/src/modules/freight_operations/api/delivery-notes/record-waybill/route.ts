import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { recordExternalWaybillSchema } from '../../../data/validators'
import { FREIGHT_DELIVERY_NOTE_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/delivery-notes/record-waybill',
  POST: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ deliveryNoteId: string }>(req, {
    parse: (raw) => recordExternalWaybillSchema.parse(raw),
    resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.delivery_notes.record_waybill',
    errorMessageKey: 'waybill_failed',
    errorFallback: 'Unable to record the external waybill.',
    toResponse: (result) => ({ deliveryNoteId: result.deliveryNoteId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Record or cancel the external Bayan Naql waybill reference',
  methods: {
    POST: {
      summary: 'Attach the waybill number issued on the TGA Bayan platform, or mark it cancelled',
      requestBody: { contentType: 'application/json', schema: recordExternalWaybillSchema },
      responses: [
        {
          status: 200,
          description: 'Waybill reference updated',
          schema: z.object({ ok: z.boolean(), deliveryNoteId: z.string().uuid() }),
        },
      ],
    },
  },
}
