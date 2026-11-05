import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PaymentGatewayDescriptorService } from '../../lib/descriptor-service'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/providers',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { resolve } = await createRequestContainer()
  const descriptorService = resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
  const items = await descriptorService.listResolved({
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  return NextResponse.json({ items })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'List payment gateway descriptors',
  methods: {
    GET: {
      summary: 'List payment gateway descriptors',
      tags: [paymentGatewaysTag],
      responses: [{ status: 200, description: 'List of safe payment gateway descriptors' }],
    },
  },
}

export default GET
