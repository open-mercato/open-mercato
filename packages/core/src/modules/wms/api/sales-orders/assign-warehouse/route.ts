import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { salesOrderWarehouseAssignSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../../inventory/helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/sales-orders/assign-warehouse',
    inputSchema: salesOrderWarehouseAssignSchema,
    commandId: 'wms.sales-order.assign-warehouse',
    describeResource: (input) => ({
      resourceKind: 'wms.sales_order_warehouse_assignment',
      resourceId: input.salesOrderId,
    }),
    mapSuccess: (result: { assignmentId: string; warehouseId: string }) => ({
      ok: true,
      assignmentId: result.assignmentId,
      warehouseId: result.warehouseId,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  assignmentId: z.string().uuid(),
  warehouseId: z.string().uuid(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Assign warehouse to sales order',
  methods: {
    POST: {
      summary: 'Assign warehouse to sales order',
      description:
        'Explicitly assigns a warehouse to a sales order. When set, the enricher returns this warehouse and the reservation automation prefers it.',
      requestBody: { contentType: 'application/json', schema: salesOrderWarehouseAssignSchema },
      responses: [
        { status: 201, description: 'Warehouse assigned', schema: successSchema },
        { status: 200, description: 'Warehouse assignment updated', schema: successSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Warehouse not found', schema: errorSchema },
        { status: 422, description: 'Warehouse is inactive', schema: errorSchema },
      ],
    },
  },
}
