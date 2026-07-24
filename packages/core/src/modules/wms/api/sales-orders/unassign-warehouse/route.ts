import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { salesOrderWarehouseUnassignSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../../inventory/helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/sales-orders/unassign-warehouse',
    inputSchema: salesOrderWarehouseUnassignSchema,
    commandId: 'wms.sales-order.unassign-warehouse',
    describeResource: (input) => ({
      resourceKind: 'wms.sales_order_warehouse_assignment',
      resourceId: input.salesOrderId,
    }),
    mapSuccess: () => ({ ok: true }),
  })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Remove warehouse assignment from sales order',
  methods: {
    POST: {
      summary: 'Remove warehouse assignment from sales order',
      description:
        'Removes an explicit warehouse assignment from a sales order. The enricher will fall back to deriving the warehouse from active reservations or the primary warehouse.',
      requestBody: { contentType: 'application/json', schema: salesOrderWarehouseUnassignSchema },
      responses: [{ status: 200, description: 'Assignment removed', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
