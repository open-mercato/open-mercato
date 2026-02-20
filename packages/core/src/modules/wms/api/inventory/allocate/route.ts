import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { inventoryAllocateBaseSchema } from '../../../data/validators'

const allocateResponseSchema = z.object({
  reservation_id: z.string().uuid(),
  movement_id: z.string().uuid(),
  status: z.string(),
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

  const schemaWithScope = inventoryAllocateBaseSchema.merge(
    z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
  )
  const parsed = (await parseScopedCommandInput(schemaWithScope, body, { container }, translate)) as Record<string, unknown>
  const { tenantId, organizationId, ...rest } = parsed

  const result = await commandBus.execute('wms.inventory.allocate', {
    ...rest,
    tenant_id: tenantId,
    organization_id: organizationId,
  })

  return Response.json(result, { status: 200 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Allocate inventory',
  methods: {
    POST: {
      summary: 'Allocate reservation',
      description: 'Allocates a reservation, converting reserved quantity to allocated and creating a pick movement.',
      requestBody: { schema: inventoryAllocateBaseSchema, description: 'Allocation parameters' },
      responses: [
        { status: 200, description: 'Allocation result', schema: allocateResponseSchema },
      ],
    },
  },
}
