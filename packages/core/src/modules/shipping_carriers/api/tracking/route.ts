import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ShippingCarrierService } from '../../lib/shipping-service'
import { trackingQuerySchema } from '../../data/validators'
import { shippingCarriersTag } from '../openapi'

export const metadata = {
  path: '/shipping-carriers/tracking',
  GET: { requireAuth: true, requireFeatures: ['shipping_carriers.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const parsed = trackingQuerySchema.safeParse({
    providerKey: url.searchParams.get('providerKey'),
    shipmentId: url.searchParams.get('shipmentId') ?? undefined,
    trackingNumber: url.searchParams.get('trackingNumber') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const tracking = await service.getTracking({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })
    return NextResponse.json(tracking)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch tracking'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Get tracking',
  methods: {
    GET: {
      summary: 'Get tracking',
      tags: [shippingCarriersTag],
      responses: [
        { status: 200, description: 'Tracking returned' },
        { status: 422, description: 'Validation failed' },
        { status: 502, description: 'Provider upstream error' },
      ],
    },
  },
}
