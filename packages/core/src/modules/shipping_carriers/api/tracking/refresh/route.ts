import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ShippingCarrierService } from '../../../lib/shipping-service'
import { trackingRefreshSchema } from '../../../data/validators'
import { shippingCarriersTag } from '../../openapi'

export const metadata = {
  path: '/shipping-carriers/tracking/refresh',
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const payload = await readJsonSafe<unknown>(req)
  const parsed = trackingRefreshSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const tracking = await service.refreshTracking({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })
    return NextResponse.json(tracking)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to refresh tracking'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Refresh tracking',
  methods: {
    POST: {
      summary: 'Refresh tracking and persist the latest shipment status',
      tags: [shippingCarriersTag],
      responses: [
        { status: 200, description: 'Tracking refreshed and shipment status persisted' },
        { status: 422, description: 'Validation failed' },
        { status: 502, description: 'Provider upstream error' },
      ],
    },
  },
}
