import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cancelOrderSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/cancel',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ orderId: string }>(req, {
    parse: (raw) => cancelOrderSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.cancel',
    errorMessageKey: 'cancel_failed',
    errorFallback: 'Unable to cancel the order.',
    toResponse: (result) => ({ orderId: result.orderId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Cancel a freight order',
  methods: {
    POST: {
      summary: 'Cancel an order that has not been invoiced',
      requestBody: { contentType: 'application/json', schema: cancelOrderSchema },
      responses: [{ status: 200, description: 'Order cancelled', schema: z.object({ ok: z.boolean(), orderId: z.string().uuid() }) }],
    },
  },
}
