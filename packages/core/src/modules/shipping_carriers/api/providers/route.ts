import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { listShippingAdapters } from '../../lib/adapter-registry'
import { shippingCarriersTag } from '../openapi'

export const metadata = {
  path: '/shipping-carriers/providers',
  GET: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adapters = listShippingAdapters()
  const providers = adapters.map((adapter) => ({
    providerKey: adapter.providerKey,
  }))
  return NextResponse.json({ providers })
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'List registered shipping providers',
  methods: {
    GET: {
      summary: 'List registered shipping providers',
      tags: [shippingCarriersTag],
      responses: [
        { status: 200, description: 'List of registered provider keys' },
      ],
    },
  },
}
