import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryReservationCreateSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/inventory/reserve',
    inputSchema: inventoryReservationCreateSchema,
    commandId: 'wms.inventory.reserve',
    describeResource: (input) => ({
      resourceKind: 'wms.inventory',
      resourceId: `${input.warehouseId}:${input.catalogVariantId}`,
    }),
    mapSuccess: (result: { reservationId: string; allocatedBuckets: Array<{ locationId: string; lotId: string | null; quantity: string }> }) => ({
      ok: true,
      reservationId: result.reservationId,
      allocatedBuckets: result.allocatedBuckets,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  reservationId: z.string().uuid(),
  allocatedBuckets: z.array(
    z.object({
      locationId: z.string().uuid(),
      lotId: z.string().uuid().nullable(),
      quantity: z.string(),
    }),
  ),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Reserve inventory',
  methods: {
    POST: {
      summary: 'Reserve inventory',
      description: 'Creates an inventory reservation and assigns available buckets using the configured stock strategy.',
      requestBody: { contentType: 'application/json', schema: inventoryReservationCreateSchema },
      responses: [{ status: 200, description: 'Inventory reserved', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 409, description: 'Insufficient stock', schema: errorSchema },
        { status: 422, description: 'Invalid tracking state', schema: errorSchema },
      ],
    },
  },
}
