import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryReservationReleaseSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/inventory/release',
    inputSchema: inventoryReservationReleaseSchema,
    commandId: 'wms.inventory.release',
    describeResource: (input) => ({
      resourceKind: 'wms.inventoryReservation',
      resourceId: input.reservationId,
    }),
    mapSuccess: () => ({ ok: true }),
  })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Release reservation',
  methods: {
    POST: {
      summary: 'Release reservation',
      description: 'Releases a previously reserved or allocated inventory reservation.',
      requestBody: { contentType: 'application/json', schema: inventoryReservationReleaseSchema },
      responses: [{ status: 200, description: 'Reservation released', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Reservation not found', schema: errorSchema },
      ],
    },
  },
}
