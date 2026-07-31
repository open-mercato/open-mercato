import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { executeWmsCustomPostRoute } from '../../../inventory/helpers'
import { reRunReservationInputSchema } from '../../../../commands/sales-order-assignment'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

const paramsSchema = z.object({
  salesOrderId: z.string().uuid(),
})

export async function POST(
  request: Request,
  routeContext: { params: { salesOrderId: string } },
) {
  const parsedParams = paramsSchema.parse(routeContext.params)
  const body = await readJsonSafe<Record<string, unknown>>(request, {})
  const scopedRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ ...body, salesOrderId: parsedParams.salesOrderId }),
  })
  return executeWmsCustomPostRoute({
    request: scopedRequest,
    routePath: `wms/sales-orders/${parsedParams.salesOrderId}/re-run-reservation`,
    inputSchema: reRunReservationInputSchema,
    commandId: 'wms.sales-order.re-run-reservation',
    describeResource: (input) => ({
      resourceKind: 'wms.sales_order_reservation',
      resourceId: input.salesOrderId,
    }),
    mapSuccess: () => ({ ok: true }),
  })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Re-run reservation for sales order',
  methods: {
    POST: {
      summary: 'Re-run reservation for sales order',
      description:
        'Triggers the automatic reservation logic for a sales order, attempting to fill any remaining shortfall.',
      responses: [{ status: 200, description: 'Reservation re-run attempted', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Order not found', schema: errorSchema },
      ],
    },
  },
}
