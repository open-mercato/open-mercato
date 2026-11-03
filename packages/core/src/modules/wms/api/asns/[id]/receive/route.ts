import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { asnReceiveLineSchema } from '../../../../data/validators'
import { executeWmsCustomPostRoute } from '../../../inventory/helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.receive_inventory'] },
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
    body: JSON.stringify({ ...body, asnId: parsedParams.id }),
  })
  return executeWmsCustomPostRoute({
    request: scopedRequest,
    routePath: `wms/asns/${parsedParams.id}/receive`,
    inputSchema: asnReceiveLineSchema,
    commandId: 'wms.asns.receive-line',
    describeResource: (input) => ({
      resourceKind: 'wms.asn',
      resourceId: input.asnId,
    }),
    mapSuccess: (result: {
      movementIds: string[]
      putawayTaskIds: string[]
      receivedQty?: number
      asnUpdatedAt?: string
    }) => ({
      ok: true,
      movementIds: result.movementIds,
      putawayTaskIds: result.putawayTaskIds,
      receivedQty: result.receivedQty,
      asnUpdatedAt: result.asnUpdatedAt,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  movementIds: z.array(z.string().uuid()),
  putawayTaskIds: z.array(z.string().uuid()),
  receivedQty: z.number().optional(),
  asnUpdatedAt: z.string().datetime().optional(),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Receive ASN line',
  methods: {
    POST: {
      summary: 'Receive ASN line',
      description:
        'Receives a line against an ASN with QC outcome. QC pass writes receipt stock at staging/dock; QC fail records audit without balance increase. Both require absolute targetReceivedQty for retry-safe attempts (optional idempotencyKey is an extra stabilizer).',
      requestBody: { contentType: 'application/json', schema: asnReceiveLineSchema },
      responses: [{ status: 200, description: 'ASN line received', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 409, description: 'Invalid receipt state', schema: errorSchema },
        { status: 422, description: 'Tracking or QC transition invalid', schema: errorSchema },
      ],
    },
  },
}
