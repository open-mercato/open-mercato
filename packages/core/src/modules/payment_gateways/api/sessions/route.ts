import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createSessionSchema } from '../../data/validators'
import { GatewayPaymentLink } from '../../data/entities'
import { buildPaymentLinkUrl, createPaymentLinkToken, hashPaymentLinkPassword } from '../../lib/payment-links'
import type { PaymentGatewayService } from '../../lib/gateway-service'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/sessions',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = createSessionSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const em = container.resolve('em') as EntityManager

  try {
    const { transaction, session } = await service.createPaymentSession({
      providerKey: parsed.data.providerKey,
      paymentId: crypto.randomUUID(),
      orderId: parsed.data.orderId,
      amount: parsed.data.amount,
      currencyCode: parsed.data.currencyCode,
      captureMethod: parsed.data.captureMethod,
      description: parsed.data.description,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      metadata: parsed.data.metadata,
      providerInput: parsed.data.providerInput,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    let paymentLinkUrl: string | null = null
    let paymentLinkToken: string | null = null
    let paymentLinkId: string | null = null

    if (parsed.data.paymentLink?.enabled) {
      paymentLinkToken = createPaymentLinkToken()
      const paymentLink = em.create(GatewayPaymentLink, {
        transactionId: transaction.id,
        token: paymentLinkToken,
        providerKey: transaction.providerKey,
        title: parsed.data.paymentLink.title?.trim() || parsed.data.description?.trim() || `${transaction.providerKey} payment`,
        description: parsed.data.paymentLink.description?.trim() || null,
        passwordHash: parsed.data.paymentLink.password?.trim()
          ? await hashPaymentLinkPassword(parsed.data.paymentLink.password.trim())
          : null,
        status: 'active',
        metadata: {
          amount: parsed.data.amount,
          currencyCode: parsed.data.currencyCode,
        },
        organizationId: auth.orgId as string,
        tenantId: auth.tenantId,
      })
      await em.persistAndFlush(paymentLink)
      paymentLinkId = paymentLink.id
      paymentLinkUrl = buildPaymentLinkUrl(new URL(req.url).origin, paymentLinkToken)
    }

    return NextResponse.json({
      transactionId: transaction.id,
      sessionId: session.sessionId,
      providerKey: transaction.providerKey,
      clientSecret: session.clientSecret,
      redirectUrl: session.redirectUrl,
      providerData: session.providerData ?? null,
      status: session.status,
      paymentId: transaction.paymentId,
      paymentLinkId,
      paymentLinkToken,
      paymentLinkUrl,
    }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create payment session'
    const status = message.includes('No gateway adapter') ? 422 : 502
    return NextResponse.json({ error: message }, { status })
  }
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Create a payment session via a gateway provider',
  methods: {
    POST: {
      summary: 'Create payment session',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 201, description: 'Payment session created' },
        { status: 422, description: 'Invalid payload or unknown provider' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
