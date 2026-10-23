import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { asnCloseSchema } from '../../../../data/validators'
import { executeWmsCustomPostRoute } from '../../../inventory/helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_asn'] },
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
    routePath: `wms/asns/${parsedParams.id}/complete`,
    inputSchema: asnCloseSchema,
    commandId: 'wms.asns.close',
    describeResource: (input) => ({
      resourceKind: 'wms.asn',
      resourceId: input.id,
    }),
    mapSuccess: (result: { status: string }) => ({
      ok: true,
      status: result.status,
    }),
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['draft', 'in_transit', 'received', 'closed']),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Complete ASN',
  methods: {
    POST: {
      summary: 'Complete ASN',
      description:
        'Marks an ASN as received when it has receipt activity (at least one line with receivedQty > 0) and lines are complete (QC-passed accepted qty meets expected), or when closeWhenShort is true for short/QC-fail receipts after some receipt activity. Header-only ASNs and zero-receipt lines are rejected even with closeWhenShort.',
      requestBody: { contentType: 'application/json', schema: asnCloseSchema },
      responses: [{ status: 200, description: 'ASN completed', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 409, description: 'Invalid receipt state', schema: errorSchema },
      ],
    },
  },
}