import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { deliverOrderSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/deliver',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ orderId: string }>(req, {
    parse: (raw) => deliverOrderSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.deliver',
    errorMessageKey: 'deliver_failed',
    errorFallback: 'Unable to record the delivery.',
    toResponse: (result) => ({ orderId: result.orderId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Record delivery of a freight order with proof of delivery',
  methods: {
    POST: {
      summary: 'Record the delivery, attaching the POD reference or document',
      requestBody: { contentType: 'application/json', schema: deliverOrderSchema },
      responses: [{ status: 200, description: 'Delivery recorded', schema: z.object({ ok: z.boolean(), orderId: z.string().uuid() }) }],
    },
  },
}
