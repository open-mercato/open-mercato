import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { putawayTaskCreateFromBalanceSchema } from '../../../data/validators'
import { executeWmsCustomPostRoute } from '../../inventory/helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_putaway'] },
}

export async function POST(request: Request) {
  return executeWmsCustomPostRoute({
    request,
    routePath: 'wms/putaway-tasks/create-from-balance',
    inputSchema: putawayTaskCreateFromBalanceSchema,
    commandId: 'wms.putaway-tasks.create-from-balance',
    describeResource: (input) => ({
      resourceKind: 'wms.putawayTask',
      resourceId: `${input.warehouseId}:${input.sourceLocationId}:${input.catalogVariantId}`,
    }),
    mapSuccess: (result: { taskId: string }) => ({
      ok: true,
      taskId: result.taskId,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  taskId: z.string().uuid(),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Create putaway task from balance',
  methods: {
    POST: {
      summary: 'Create putaway task from balance',
      description: 'Manually creates an open putaway task against existing staged stock.',
      requestBody: { contentType: 'application/json', schema: putawayTaskCreateFromBalanceSchema },
      responses: [{ status: 200, description: 'Putaway task created', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 422, description: 'Invalid location', schema: errorSchema },
      ],
    },
  },
}
