import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { generateAbstractSchema } from '../../../data/validators'
import { FREIGHT_CONTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/abstracts/generate',
  POST: { requireAuth: true, requireFeatures: ['freight.abstracts.generate'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ abstractId: string }>(req, {
    parse: (raw) => generateAbstractSchema.parse(raw),
    resourceKind: FREIGHT_CONTRACT_ENTITY_ID,
    resourceId: (input) => String(input.contractId),
    commandId: 'freight_operations.abstracts.generate',
    errorMessageKey: 'abstract_generate_failed',
    errorFallback: 'Unable to generate the abstract.',
    toResponse: (result) => ({ abstractId: result.abstractId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Generate a trip abstract for a contract period',
  methods: {
    POST: {
      summary: 'Snapshot every delivered, unbilled trip of the contract inside the period into a draft abstract',
      requestBody: { contentType: 'application/json', schema: generateAbstractSchema },
      responses: [
        {
          status: 200,
          description: 'Abstract generated',
          schema: z.object({ ok: z.boolean(), abstractId: z.string().uuid() }),
        },
      ],
    },
  },
}
