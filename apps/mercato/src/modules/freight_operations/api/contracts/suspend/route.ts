import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { contractActionSchema } from '../../../data/validators'
import { FREIGHT_CONTRACT_ENTITY_ID } from '../../../commands/entities'
import { executeFreightAction } from '../../../lib/apiAction'

export const metadata = {
  path: '/freight_operations/contracts/suspend',
  POST: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
}

export async function POST(req: Request) {
  return executeFreightAction<{ contractId: string }>(req, {
    parse: (raw) => contractActionSchema.parse(raw),
    resourceKind: FREIGHT_CONTRACT_ENTITY_ID,
    resourceId: (input) => String(input.id),
    commandId: 'freight_operations.contracts.suspend',
    errorMessageKey: 'contract_action_failed',
    errorFallback: 'Unable to suspend the contract.',
    toResponse: (result) => ({ contractId: result.contractId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Suspend an active freight contract',
  methods: {
    POST: {
      summary: 'Suspend the contract (new trips are refused while suspended)',
      requestBody: { contentType: 'application/json', schema: contractActionSchema },
      responses: [{ status: 200, description: 'Contract suspended', schema: z.object({ ok: z.boolean(), contractId: z.string().uuid() }) }],
    },
  },
}
