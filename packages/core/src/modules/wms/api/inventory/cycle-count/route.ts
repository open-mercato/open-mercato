import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { cycleCountSchema } from '../../../data/validators'

const cycleCountResponseSchema = z.object({
  balance_id: z.string().uuid(),
  movement_id: z.string().uuid(),
  previous_on_hand: z.number(),
  counted_quantity: z.number(),
  delta: z.number(),
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

  const schemaWithScope = cycleCountSchema.merge(
    z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
  )
  const parsed = (await parseScopedCommandInput(schemaWithScope, body, { container }, translate)) as Record<string, unknown>
  const { tenantId, organizationId, ...rest } = parsed

  const result = await commandBus.execute('wms.inventory.cycle_count', {
    ...rest,
    tenant_id: tenantId,
    organization_id: organizationId,
  })

  return Response.json(result, { status: 200 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Cycle count inventory',
  methods: {
    POST: {
      summary: 'Perform cycle count',
      description: 'Reconciles inventory by recording a physical count and adjusting the balance.',
      requestBody: { schema: cycleCountSchema, description: 'Cycle count parameters' },
      responses: [
        { status: 200, description: 'Cycle count result', schema: cycleCountResponseSchema },
      ],
    },
  },
}
