import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryMoveSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.adjust_inventory'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/inventory/move',
    inputSchema: inventoryMoveSchema,
    commandId: 'wms.inventory.move',
    describeResource: (input) => ({
      resourceKind: 'wms.inventory',
      resourceId: `${input.warehouseId}:${input.fromLocationId}:${input.catalogVariantId}`,
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
  summary: 'Move inventory',
  methods: {
    POST: {
      summary: 'Move inventory',
      description: 'Moves stock from one location to another within a warehouse and appends a transfer movement.',
      requestBody: { contentType: 'application/json', schema: inventoryMoveSchema },
      responses: [{ status: 200, description: 'Inventory moved', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 409, description: 'Insufficient stock', schema: errorSchema },
        { status: 422, description: 'Invalid location', schema: errorSchema },
      ],
    },
  },
}
