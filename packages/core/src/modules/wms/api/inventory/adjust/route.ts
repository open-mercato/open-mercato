import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { inventoryAdjustSchema } from '../../../data/validators'

const adjustResponseSchema = z.object({
  balance_id: z.string().uuid(),
  movement_id: z.string().uuid(),
  quantity_on_hand: z.number(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_inventory'] },
}

export async function POST(
  request: NextRequest,
  { container }: { container: any },
) {
  const body = await request.json()
  const { translate } = await resolveTranslations()
  const commandBus = container.resolve<any>('commandBus')

  const schemaWithScope = inventoryAdjustSchema.merge(
    z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
  )
  const parsed = (await parseScopedCommandInput(schemaWithScope, body, { container }, translate)) as Record<string, unknown>
  const { tenantId, organizationId, ...rest } = parsed

  const result = await commandBus.execute('wms.inventory.adjust', {
    ...rest,
    tenant_id: tenantId,
    organization_id: organizationId,
  })

  return Response.json(result, { status: 200 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Adjust inventory balance',
  methods: {
    POST: {
      summary: 'Adjust inventory',
      description: 'Adjusts inventory balance by a delta quantity at a specific location.',
      requestBody: { schema: inventoryAdjustSchema, description: 'Adjustment parameters' },
      responses: [
        { status: 200, description: 'Adjustment result', schema: adjustResponseSchema },
      ],
    },
  },
}
