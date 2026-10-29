import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { putawayTaskAssignSchema } from '../../../../data/validators'
import { executeWmsCustomPostRoute } from '../../../inventory/helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_putaway'] },
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
    routePath: `wms/putaway-tasks/${parsedParams.id}/assign`,
    inputSchema: putawayTaskAssignSchema,
    commandId: 'wms.putaway-tasks.assign',
    describeResource: (input) => ({
      resourceKind: 'wms.putawayTask',
      resourceId: input.id,
    }),
    mapSuccess: () => ({ ok: true }),
  })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Assign putaway task',
  methods: {
    POST: {
      summary: 'Assign putaway task',
      description: 'Assigns a putaway task to a user.',
      requestBody: { contentType: 'application/json', schema: putawayTaskAssignSchema },
      responses: [{ status: 200, description: 'Putaway task assigned', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 409, description: 'Invalid putaway state', schema: errorSchema },
      ],
    },
  },
}
