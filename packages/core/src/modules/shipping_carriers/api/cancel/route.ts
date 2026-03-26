import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ShippingCarrierService } from '../../lib/shipping-service'
import { ShipmentCancelNotAllowedError } from '../../lib/status-sync'
import { cancelShipmentSchema } from '../../data/validators'
import { shippingCarriersTag } from '../openapi'

export const metadata = {
  path: '/shipping-carriers/cancel',
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const payload = await readJsonSafe<unknown>(req)
  const parsed = cancelShipmentSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const result = await service.cancelShipment({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })
    return NextResponse.json(result)
  } catch (error: unknown) {
    if (error instanceof ShipmentCancelNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    const message = error instanceof Error ? error.message : 'Failed to cancel shipment'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Cancel shipment',
  methods: {
    POST: {
      summary: 'Cancel shipment',
      tags: [shippingCarriersTag],
      responses: [
        { status: 200, description: 'Shipment cancelled' },
        { status: 422, description: 'Validation failed or shipment cannot be cancelled in its current status' },
        { status: 502, description: 'Provider upstream error' },
      ],
    },
  },
}
