import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { CheckoutLink, CheckoutTransaction } from '../../../../../data/entities'
import { handleCheckoutRouteError, requireCheckoutPasswordSession } from '../../../../helpers'
import { checkoutTag } from '../../../../openapi'

export const metadata = {
  path: '/checkout/pay/[slug]/status/[transactionId]',
  GET: { requireAuth: false },
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; transactionId: string }> | { slug: string; transactionId: string } }) {
  try {
    const resolvedParams = await params
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const paymentGatewayService = container.resolve('paymentGatewayService') as PaymentGatewayService
    const link = await em.findOne(CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
    })
    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }
    if (link.passwordHash) {
      requireCheckoutPasswordSession(req, link.slug)
    }
    let transaction = await em.findOne(CheckoutTransaction, {
      id: resolvedParams.transactionId,
      linkId: link.id,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    })
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    if (transaction.gatewayTransactionId && (transaction.status === 'processing' || transaction.status === 'pending')) {
      await paymentGatewayService.getPaymentStatus(transaction.gatewayTransactionId, {
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      }).catch(() => null)
      transaction = await em.findOne(CheckoutTransaction, {
        id: resolvedParams.transactionId,
        linkId: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      })
    }
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    return NextResponse.json({
      status: transaction.status,
      paymentStatus: transaction.paymentStatus ?? null,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
