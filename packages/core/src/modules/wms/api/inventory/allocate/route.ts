import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryReservationAllocateSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/inventory/allocate',
    inputSchema: inventoryReservationAllocateSchema,
    commandId: 'wms.inventory.allocate',
    describeResource: (input) => ({
      resourceKind: 'wms.inventoryReservation',
      resourceId: input.reservationId,
    }),
    mapSuccess: (result: { allocationState: 'allocated' }) => ({
      ok: true,
      allocationState: result.allocationState,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  allocationState: z.literal('allocated'),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Allocate reservation',
  methods: {
    POST: {
      summary: 'Allocate reservation',
      description: 'Converts a reservation from reserved quantity into allocated quantity on the selected stock buckets.',
      requestBody: { contentType: 'application/json', schema: inventoryReservationAllocateSchema },
      responses: [{ status: 200, description: 'Reservation allocated', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Reservation not found', schema: errorSchema },
        { status: 409, description: 'Invalid reservation state', schema: errorSchema },
      ],
    },
  },
}
