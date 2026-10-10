import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { abstractRespondSchema } from '../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

/**
 * Staff record the customer's acceptance or dispute here when it arrived
 * outside the portal (phone, email, signed printout). The origin is pinned to
 * `staff` by this route — the future customer-portal route calls the same
 * command and pins `customer_portal` — so the request body cannot claim the
 * response came from the customer's own session.
 */
export const metadata = {
  path: '/freight_operations/abstracts/respond',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.resolve'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string; status: string }>(req, {
    parse: (raw) => ({ ...abstractRespondSchema.parse(raw), origin: 'staff' as const }),
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.abstracts.respond',
    errorMessageKey: 'abstract_respond_failed',
    errorFallback: 'Unable to record the customer response.',
    toResponse: (result) => ({ abstractId: result.abstractId, status: result.status }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Record the customer response to a submitted abstract',
  methods: {
    POST: {
      summary: 'Accept the abstract for the customer, or record the lines they disputed',
      requestBody: { contentType: 'application/json', schema: abstractRespondSchema },
      responses: [
        {
          status: 200,
          description: 'Response recorded',
          schema: z.object({
            ok: z.boolean(),
            abstractId: z.string().uuid(),
            status: z.enum(['approved', 'disputed']),
          }),
        },
      ],
    },
  },
}
