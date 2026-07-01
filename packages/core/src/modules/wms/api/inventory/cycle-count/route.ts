import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryCycleCountSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.cycle_count'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/inventory/cycle-count',
    inputSchema: inventoryCycleCountSchema,
    commandId: 'wms.inventory.cycleCount',
    describeResource: (input) => ({
      resourceKind: 'wms.inventory',
      resourceId: `${input.warehouseId}:${input.locationId}:${input.catalogVariantId}`,
    }),
    mapSuccess: (result: { adjustmentDelta: string; movementId: string | null }) => ({
      ok: true,
      adjustmentDelta: result.adjustmentDelta,
      movementId: result.movementId,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  adjustmentDelta: z.string(),
  movementId: z.string().uuid().nullable(),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Cycle count reconcile',
  methods: {
    POST: {
      summary: 'Cycle count reconcile',
      description: 'Reconciles a counted quantity against the current on-hand balance and appends a cycle-count movement when a delta exists.',
      requestBody: { contentType: 'application/json', schema: inventoryCycleCountSchema },
      responses: [{ status: 200, description: 'Cycle count reconciled', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Invalid location', schema: errorSchema },
      ],
    },
  },
}
