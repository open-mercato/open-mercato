import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PaymentGatewayService } from '../../../lib/gateway-service'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const transactionId = url.searchParams.get('transactionId')
  if (!transactionId) {
    return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService

  try {
    const transaction = await service.findTransaction(transactionId)
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    if (transaction.organizationId !== auth.orgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json({
      transactionId: transaction.id,
      paymentId: transaction.paymentId,
      providerKey: transaction.providerKey,
      sessionId: transaction.providerSessionId,
      status: transaction.unifiedStatus,
      gatewayStatus: transaction.gatewayStatus,
      amount: transaction.amount,
      currencyCode: transaction.currencyCode,
      redirectUrl: transaction.redirectUrl,
      clientSecret: transaction.clientSecret,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Get payment transaction status',
  methods: {
    GET: {
      summary: 'Get transaction status',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Transaction status' },
        { status: 404, description: 'Transaction not found' },
      ],
    },
  },
}
