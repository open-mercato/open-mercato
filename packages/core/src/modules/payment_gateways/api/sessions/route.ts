import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createSessionSchema } from '../../data/validators'
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
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    return NextResponse.json({
      transactionId: transaction.id,
      sessionId: session.sessionId,
      providerKey: transaction.providerKey,
      clientSecret: session.clientSecret,
      redirectUrl: session.redirectUrl,
      providerData: session.providerData ?? null,
      status: session.status,
      paymentId: transaction.paymentId,
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
