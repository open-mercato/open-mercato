import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { cancelCarrierShipment } from '../../../../lib/shipping-service'

const bodySchema = z.object({
  providerKey: z.string().trim().min(1),
  shipmentId: z.string().trim().min(1),
  reason: z.string().trim().optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
} as const

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 422 })

  const container = await createRequestContainer()
  const integrationCredentials = container.resolve('integrationCredentials') as {
    resolve: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<Record<string, unknown> | null>
  }
  const credentials = await integrationCredentials.resolve(`carrier_${parsed.data.providerKey}`, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  try {
    const result = await cancelCarrierShipment(parsed.data.providerKey, {
      shipmentId: parsed.data.shipmentId,
      reason: parsed.data.reason,
      credentials: credentials ?? {},
    })

    return NextResponse.json({ status: result.status })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to cancel shipment' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Shipping Carriers',
  summary: 'Cancel shipment',
  methods: {
    POST: {
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Cancelled' }],
      errors: [{ status: 422, description: 'Validation failed' }, { status: 502, description: 'Carrier upstream error' }],
    },
  },
}
