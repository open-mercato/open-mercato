import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ShippingCarrierService } from '../../lib/shipping-service'
import { searchDropOffPointsQuerySchema } from '../../data/validators'
import { shippingCarriersTag } from '../openapi'

export const metadata = {
  path: '/shipping-carriers/points',
  GET: { requireAuth: true, requireFeatures: ['shipping_carriers.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const parsed = searchDropOffPointsQuerySchema.safeParse({
    providerKey: url.searchParams.get('providerKey'),
    query: url.searchParams.get('query') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    postCode: url.searchParams.get('postCode') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const points = await service.searchDropOffPoints({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })
    return NextResponse.json({ points })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to search drop-off points'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Search drop-off points',
  methods: {
    GET: {
      summary: 'Search carrier drop-off points (lockers, POP points)',
      tags: [shippingCarriersTag],
      responses: [
        { status: 200, description: 'Points returned' },
        { status: 422, description: 'Validation failed' },
        { status: 502, description: 'Provider upstream error or unsupported' },
      ],
    },
  },
}
