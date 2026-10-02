import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { putawayTaskCompleteSchema } from '../../../../data/validators'
import { executeWmsCustomPostRoute } from '../../../inventory/helpers'

export const metadata = {
  // Floor ACL: stock-moving operators (`wms.adjust_inventory`) and managers both hold this.
  // Command also allows `wms.manage_putaway` for any task, or adjust + assignee match.
  POST: { requireAuth: true, requireFeatures: ['wms.adjust_inventory'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export async function POST(request: Request, routeContext: { params: { id: string } }) {
  const parsedParams = paramsSchema.parse(routeContext.params)
  const body = await readJsonSafe<Record<string, unknown>>(request, {})
  const scopedRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ ...body, id: parsedParams.id }),
  })
  return executeWmsCustomPostRoute({
    request: scopedRequest,
    routePath: `wms/putaway-tasks/${parsedParams.id}/complete`,
    inputSchema: putawayTaskCompleteSchema,
    commandId: 'wms.putaway-tasks.complete',
    describeResource: (input) => ({
      resourceKind: 'wms.putawayTask',
      resourceId: input.id,
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
  summary: 'Complete putaway task',
  methods: {
    POST: {
      summary: 'Complete putaway task',
      description:
        'Confirms putaway quantity and target location, then moves stock staging→storage via an InventoryMovement of type putaway. Requires `wms.adjust_inventory`. Callers with `wms.manage_putaway` may complete any task; operators may complete only when the task is assigned to them.',
      requestBody: { contentType: 'application/json', schema: putawayTaskCompleteSchema },
      responses: [{ status: 200, description: 'Putaway completed', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 409, description: 'Invalid putaway state or insufficient stock', schema: errorSchema },
        { status: 422, description: 'Invalid or inactive location', schema: errorSchema },
      ],
    },
  },
}
