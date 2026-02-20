import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { inventoryAllocateBaseSchema } from '../../../data/validators'
import { createWmsCrudOpenApi, defaultOkResponseSchema } from '../../../lib/openapi'

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

export const openApi = createWmsCrudOpenApi({
  resourceName: 'InventoryAllocation',
  pluralName: 'Inventory Allocations',
  querySchema: z.object({}),
  listResponseSchema: defaultOkResponseSchema,
  create: {
    schema: z.object({
      reservation_id: z.string().uuid().optional(),
      warehouse_id: z.string().uuid().optional(),
      catalog_variant_id: z.string().uuid().optional(),
      source_type: z.enum(['order', 'transfer', 'manual']).optional(),
      source_id: z.string().uuid().optional(),
      location_id: z.string().uuid().optional(),
    }),
    description: 'Allocates a reservation, converting reserved quantity to allocated and creating a pick movement.',
  },
})
