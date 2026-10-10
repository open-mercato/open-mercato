import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractResolveSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/resolve',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.resolve'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string; status: string }>(req, {
    parse: (raw) => abstractResolveSchema.parse(raw),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.resolve',
    errorMessageKey: 'abstract_resolve_failed',
    errorFallback: 'Unable to resolve the abstract disputes.',
    toResponse: (result) => ({ abstractId: result.abstractId, status: result.status }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Resolve the disputed lines of a trip abstract',
  methods: {
    POST: {
      summary: 'Settle each disputed line; the abstract is approved once no line is still disputed',
      requestBody: { contentType: 'application/json', schema: abstractResolveSchema },
      responses: [
        {
          status: 200,
          description: 'Disputes resolved',
          schema: z.object({
            ok: z.boolean(),
            abstractId: z.string().uuid(),
            status: z.enum(['disputed', 'approved']),
          }),
        },
      ],
    },
  },
}
