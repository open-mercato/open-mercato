import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { orderActionSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/complete',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ orderId: string }>(req, {
    parse: (raw) => orderActionSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.complete',
    errorMessageKey: 'complete_failed',
    errorFallback: 'Unable to complete the order.',
    toResponse: (result) => ({ orderId: result.orderId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Complete a delivered freight order',
  methods: {
    POST: {
      summary: 'Move a delivered order to completed (ready for invoicing)',
      requestBody: { contentType: 'application/json', schema: orderActionSchema },
      responses: [{ status: 200, description: 'Order completed', schema: z.object({ ok: z.boolean(), orderId: z.string().uuid() }) }],
    },
  },
}
