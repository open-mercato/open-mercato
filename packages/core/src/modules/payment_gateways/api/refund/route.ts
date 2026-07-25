import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { refundSchema } from '../../data/validators'
import type { PaymentGatewayService } from '../../lib/gateway-service'
import { paymentGatewaysTag } from '../openapi'
import {
  resolveUserFeatures,
  runPaymentGatewayMutationGuardAfterSuccess,
  runPaymentGatewayMutationGuards,
} from '../guards'

const gatewayTransactionResourceKind = 'payment_gateways.gateway_transaction'

export const metadata = {
  path: '/payment_gateways/refund',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.refund'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = refundSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const guardResult = await runPaymentGatewayMutationGuards(
    container,
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub ?? '',
      resourceKind: gatewayTransactionResourceKind,
      resourceId: parsed.data.transactionId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data as Record<string, unknown>,
    },
    resolveUserFeatures(auth),
  )
  if (!guardResult.ok) {
    return NextResponse.json(
      guardResult.errorBody ?? { error: 'Operation blocked by guard' },
      { status: guardResult.errorStatus ?? 422 },
    )
  }

  const service = container.resolve('paymentGatewayService') as PaymentGatewayService

  try {
    const result = await service.refundPayment(
      parsed.data.transactionId,
      parsed.data.amount,
      parsed.data.reason,
      { organizationId: auth.orgId as string, tenantId: auth.tenantId },
      parsed.data.operationId,
    )
    await runPaymentGatewayMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub ?? '',
      resourceKind: gatewayTransactionResourceKind,
      resourceId: parsed.data.transactionId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Refund failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Refund a captured payment',
  methods: {
    POST: {
      summary: 'Refund payment',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment refunded' },
        { status: 409, description: 'Invalid payment status transition' },
        { status: 422, description: 'Invalid payload' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
