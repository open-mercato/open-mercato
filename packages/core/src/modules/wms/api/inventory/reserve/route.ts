import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../../../lib/utils'
import { reservationCreateSchema } from '../../../data/validators'

const reserveResponseSchema = z.object({
  reservation_id: z.string().uuid(),
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

  const schemaWithScope = reservationCreateSchema.merge(
    z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
  )
  const parsed = (await parseScopedCommandInput(schemaWithScope, body, { container }, translate)) as Record<string, unknown>
  const { tenantId, organizationId, ...rest } = parsed

  const result = await commandBus.execute('wms.inventory.reserve', {
    ...rest,
    tenant_id: tenantId,
    organization_id: organizationId,
  })

  return Response.json(result, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Reserve inventory',
  methods: {
    POST: {
      summary: 'Create inventory reservation',
      description: 'Reserves inventory using FIFO/LIFO/FEFO strategy based on product profile.',
      requestBody: { schema: reservationCreateSchema, description: 'Reservation parameters' },
      responses: [
        { status: 201, description: 'Reservation created', schema: reserveResponseSchema },
      ],
    },
  },
}
