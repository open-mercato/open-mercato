import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryReceiveSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.adjust_inventory'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/inventory/receive',
    inputSchema: inventoryReceiveSchema,
    commandId: 'wms.inventory.receive',
    describeResource: (input) => ({
      resourceKind: 'wms.inventory',
      resourceId: `${input.warehouseId}:${input.locationId}:${input.catalogVariantId}`,
    }),
    mapSuccess: (result: { movementId: string }) => ({
      ok: true,
      movementId: result.movementId,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  movementId: z.string().uuid(),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Receive inventory',
  methods: {
    POST: {
      summary: 'Receive inventory',
      description: 'Records inbound inventory receipt and appends a receipt movement ledger row.',
      requestBody: { contentType: 'application/json', schema: inventoryReceiveSchema },
      responses: [{ status: 200, description: 'Inventory received', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Invalid location', schema: errorSchema },
      ],
    },
  },
}
