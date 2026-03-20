import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { CheckoutLink, CheckoutTransaction } from '../../../../../data/entities'
import { checkoutStatusRateLimitConfig } from '../../../../../lib/rateLimiter'
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
    try {
      const rateLimiter = container.resolve('rateLimiterService') as RateLimiterService
      const ip = getClientIp(req, 1) ?? 'unknown'
      const rateLimitResponse = await checkRateLimit(rateLimiter, checkoutStatusRateLimitConfig, `checkout-status:${ip}`, 'Too many checkout status requests. Please try again later.')
      if (rateLimitResponse) return rateLimitResponse
    } catch {
      // Rate limiting is fail-open
    }
    const em = container.resolve('em')
    const paymentGatewayService = container.resolve('paymentGatewayService') as PaymentGatewayService
    const link = await findOneWithDecryption(em, CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
    })
    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }
    if (link.passwordHash) {
      requireCheckoutPasswordSession(req, link.slug, {
        linkId: link.id,
        sessionVersion: link.passwordHash,
      })
    }
    let transaction = await findOneWithDecryption(em, CheckoutTransaction, {
      id: resolvedParams.transactionId,
      linkId: link.id,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    }, undefined, { organizationId: link.organizationId, tenantId: link.tenantId })
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    if (transaction.gatewayTransactionId && (transaction.status === 'processing' || transaction.status === 'pending')) {
      await paymentGatewayService.getPaymentStatus(transaction.gatewayTransactionId, {
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      }).catch(() => null)
      transaction = await findOneWithDecryption(em, CheckoutTransaction, {
        id: resolvedParams.transactionId,
        linkId: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      }, undefined, { organizationId: link.organizationId, tenantId: link.tenantId })
    }
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    return NextResponse.json({
      status: transaction.status,
      paymentStatus: transaction.paymentStatus ?? null,
      link: {
        title: link.title ?? link.name ?? null,
        successTitle: link.successTitle ?? null,
        successMessage: link.successMessage ?? null,
        cancelTitle: link.cancelTitle ?? null,
        cancelMessage: link.cancelMessage ?? null,
        errorTitle: link.errorTitle ?? null,
        errorMessage: link.errorMessage ?? null,
      },
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
