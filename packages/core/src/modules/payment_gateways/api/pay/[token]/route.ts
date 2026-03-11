import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { GatewayPaymentLink, GatewayTransaction } from '../../../data/entities'
import { isGatewayTransactionSettled, verifyPaymentLinkAccessToken } from '../../../lib/payment-links'
import type { PaymentGatewayService } from '../../../lib/gateway-service'
import { paymentGatewaysTag } from '../../openapi'

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export const metadata = {
  path: '/payment_gateways/pay/[token]',
  GET: { requireAuth: false },
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Payment link token is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const link = await findOneWithDecryption(em, GatewayPaymentLink, { token, deletedAt: null })

  if (!link) {
    return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
  }

  const scope = { organizationId: link.organizationId, tenantId: link.tenantId }
  const transaction = await findOneWithDecryption(
    em,
    GatewayTransaction,
    { id: link.transactionId, organizationId: link.organizationId, tenantId: link.tenantId, deletedAt: null },
    undefined,
    scope,
  )

  if (!transaction) {
    return NextResponse.json({ error: 'Payment transaction not found' }, { status: 404 })
  }

  const accessToken = req.headers.get('x-payment-link-access')
  const accessGranted = !link.passwordHash || verifyPaymentLinkAccessToken(link, accessToken)
  if (link.passwordHash && !accessGranted) {
    return NextResponse.json({
      passwordRequired: true,
      link: {
        token: link.token,
        title: link.title,
        description: link.description ?? null,
        providerKey: link.providerKey,
        status: link.status,
      },
    }, { status: 403 })
  }

  if (!isGatewayTransactionSettled(transaction) && transaction.providerSessionId) {
    const service = container.resolve('paymentGatewayService') as PaymentGatewayService
    try {
      await service.getPaymentStatus(transaction.id, scope)
    } catch {
      // Public page should stay available even when the provider poll fails.
    }
  }

  await em.refresh(transaction)
  if (link.status === 'active' && isGatewayTransactionSettled(transaction)) {
    link.status = 'completed'
    link.completedAt = link.completedAt ?? new Date()
    await em.flush()
  }

  const integration = getAllIntegrations().find((entry) => entry.providerKey === link.providerKey)

  return NextResponse.json({
    passwordRequired: false,
    accessGranted,
    link: {
      id: link.id,
      token: link.token,
      title: link.title,
      description: link.description ?? null,
      providerKey: link.providerKey,
      status: link.status,
      completedAt: toIso(link.completedAt),
      amount: typeof link.metadata?.amount === 'number' ? link.metadata.amount : Number(transaction.amount),
      currencyCode:
        typeof link.metadata?.currencyCode === 'string' ? link.metadata.currencyCode : transaction.currencyCode,
      paymentLinkWidgetSpotId: integration?.paymentGateway?.paymentLinkWidgetSpotId ?? null,
    },
    transaction: {
      id: transaction.id,
      paymentId: transaction.paymentId,
      providerKey: transaction.providerKey,
      providerSessionId: transaction.providerSessionId ?? null,
      unifiedStatus: transaction.unifiedStatus,
      gatewayStatus: transaction.gatewayStatus ?? null,
      redirectUrl: transaction.redirectUrl ?? null,
      clientSecret: transaction.clientSecret ?? null,
      amount: Number(transaction.amount),
      currencyCode: transaction.currencyCode,
      gatewayMetadata: transaction.gatewayMetadata ?? null,
      createdAt: toIso(transaction.createdAt),
      updatedAt: toIso(transaction.updatedAt),
    },
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Read a public payment link',
  methods: {
    GET: {
      summary: 'Get payment link details',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment link details' },
        { status: 403, description: 'Password required' },
        { status: 404, description: 'Payment link not found' },
      ],
    },
  },
}

export default GET
