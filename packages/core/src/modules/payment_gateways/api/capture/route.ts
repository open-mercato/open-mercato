import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { captureSchema } from '../../data/validators'
import type { PaymentGatewayService } from '../../lib/gateway-service'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/capture',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.capture'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = captureSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService

  try {
    const result = await service.capturePayment(
      parsed.data.transactionId,
      parsed.data.amount,
      { organizationId: auth.orgId as string, tenantId: auth.tenantId },
    )
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Capture failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Capture an authorized payment',
  methods: {
    POST: {
      summary: 'Capture payment',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment captured' },
        { status: 422, description: 'Invalid payload' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
