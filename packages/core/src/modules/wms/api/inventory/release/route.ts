import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { inventoryReleaseBaseSchema } from '../../../data/validators'

const releaseResponseSchema = z.object({
  reservation_id: z.string().uuid(),
  status: z.string(),
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

  const schemaWithScope = inventoryReleaseBaseSchema.merge(
    z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
  )
  const parsed = (await parseScopedCommandInput(schemaWithScope, body, { container }, translate)) as Record<string, unknown>
  const { tenantId, organizationId, ...rest } = parsed

  const result = await commandBus.execute('wms.inventory.release', {
    ...rest,
    tenant_id: tenantId,
    organization_id: organizationId,
  })

  return Response.json(result, { status: 200 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Release inventory reservation',
  methods: {
    POST: {
      summary: 'Release reservation',
      description: 'Releases an active inventory reservation, restoring available quantity.',
      requestBody: { schema: inventoryReleaseBaseSchema, description: 'Release parameters' },
      responses: [
        { status: 200, description: 'Reservation released', schema: releaseResponseSchema },
      ],
    },
  },
}
