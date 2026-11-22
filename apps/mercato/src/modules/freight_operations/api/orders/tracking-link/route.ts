import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { orderActionSchema } from '../../../data/validators'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/orders/tracking-link',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ orderId: string; trackingToken: string }>(req, {
    parse: (raw) => orderActionSchema.parse(raw),
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.orders.ensure_tracking_token',
    errorMessageKey: 'tracking_link_failed',
    errorFallback: 'Unable to create the tracking link.',
    toResponse: (result) => ({
      orderId: result.orderId,
      trackingToken: result.trackingToken,
    }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Create or return a public order tracking link token',
  methods: {
    POST: {
      summary: 'Ensure the order has a public tracking token',
      requestBody: { contentType: 'application/json', schema: orderActionSchema },
      responses: [{
        status: 200,
        description: 'Tracking token',
        schema: z.object({
          ok: z.boolean(),
          orderId: z.string().uuid(),
          trackingToken: z.string(),
        }),
      }],
    },
  },
}
