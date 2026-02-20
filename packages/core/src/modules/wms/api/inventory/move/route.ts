import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { inventoryMoveSchema } from '../../../data/validators'

const moveResponseSchema = z.object({
  movement_id: z.string().uuid(),
  source_balance_id: z.string().uuid(),
  dest_balance_id: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.manage_inventory'] },
}

export async function POST(
  request: NextRequest,
  { container }: { container: AppContainer },
) {
  const body = await request.json()
  const { translate } = await resolveTranslations()
  const commandBus = container.resolve<CommandBus>('commandBus')

  const schemaWithScope = inventoryMoveSchema.merge(
    z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
  )
  const parsed = (await parseScopedCommandInput(schemaWithScope, body, { container }, translate)) as Record<string, unknown>
  const { tenantId, organizationId, ...rest } = parsed

  const result = await commandBus.execute('wms.inventory.move', {
    ...rest,
    tenant_id: tenantId,
    organization_id: organizationId,
  })

  return Response.json(result, { status: 200 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Move inventory between locations',
  methods: {
    POST: {
      summary: 'Move inventory',
      description: 'Moves inventory from one location to another within the same warehouse.',
      requestBody: { schema: inventoryMoveSchema, description: 'Move parameters' },
      responses: [
        { status: 200, description: 'Move result', schema: moveResponseSchema },
      ],
    },
  },
}
