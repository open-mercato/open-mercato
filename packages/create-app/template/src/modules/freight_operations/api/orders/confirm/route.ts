import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { orderActionSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/confirm',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ orderId: string }>(req, {
    parse: (raw) => orderActionSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.confirm',
    errorMessageKey: 'confirm_failed',
    errorFallback: 'Unable to confirm the order.',
    toResponse: (result) => ({ orderId: result.orderId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Confirm a draft freight order',
  methods: {
    POST: {
      summary: 'Move a draft order to confirmed',
      requestBody: { contentType: 'application/json', schema: orderActionSchema },
      responses: [{ status: 200, description: 'Order confirmed', schema: z.object({ ok: z.boolean(), orderId: z.string().uuid() }) }],
    },
  },
}
