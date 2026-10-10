import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assignOrderSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/assign',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ orderId: string }>(req, {
    parse: (raw) => assignOrderSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.assign',
    errorMessageKey: 'assign_failed',
    errorFallback: 'Unable to assign the order.',
    toResponse: (result) => ({ orderId: result.orderId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Assign a vehicle and driver to a freight order',
  methods: {
    POST: {
      summary: 'Check availability, then assign the vehicle and driver',
      requestBody: { contentType: 'application/json', schema: assignOrderSchema },
      responses: [{ status: 200, description: 'Order assigned', schema: z.object({ ok: z.boolean(), orderId: z.string().uuid() }) }],
    },
  },
}
