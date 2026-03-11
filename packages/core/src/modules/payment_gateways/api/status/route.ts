import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PaymentGatewayService } from '../../lib/gateway-service'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/status',
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
    const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }
    const transaction = await service.findTransaction(transactionId, scope)
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const status = await service.getPaymentStatus(transactionId, scope)

    return NextResponse.json({
      transactionId: transaction.id,
      paymentId: transaction.paymentId,
      providerKey: transaction.providerKey,
      sessionId: transaction.providerSessionId,
      status: status.status,
      gatewayStatus: transaction.gatewayStatus,
      amount: status.amount,
      amountReceived: status.amountReceived,
      currencyCode: status.currencyCode,
      redirectUrl: transaction.redirectUrl,
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
