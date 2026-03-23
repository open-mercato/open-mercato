import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PaymentGatewayDescriptorService } from '../../../lib/descriptor-service'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  path: '/payment_gateways/providers/[providerKey]',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

export async function GET(request: Request, { params }: { params: Promise<{ providerKey: string }> | { providerKey: string } }) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolvedParams = await params
  const providerKey = resolvedParams?.providerKey?.trim()
  if (!providerKey) {
    return NextResponse.json({ error: 'Provider key is required' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const descriptorService = resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
  const descriptor = await descriptorService.getResolved(providerKey, {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!descriptor) {
    return NextResponse.json({ error: 'Provider descriptor not found' }, { status: 404 })
  }
  return NextResponse.json(descriptor)
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Get payment gateway descriptor',
  methods: {
    GET: {
      summary: 'Get payment gateway descriptor',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Provider descriptor' },
        { status: 404, description: 'Provider descriptor not found' },
      ],
    },
  },
}

export default GET
