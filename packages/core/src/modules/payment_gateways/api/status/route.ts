import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { getStatusSchema } from '../../data/validators'
import type { PaymentGatewayService } from '../../lib/gateway-service'
import { paymentGatewaysTag } from '../openapi'

const gatewayTransactionResourceKind = 'payment_gateways.gateway_transaction'

export const metadata = {
  path: '/payment_gateways/status',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
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
  const parsedTransactionId = getStatusSchema.safeParse({ transactionId })
  if (!parsedTransactionId.success) {
    return NextResponse.json({ error: 'Invalid transactionId', details: parsedTransactionId.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService

  try {
    const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }
    const transaction = await service.findTransaction(transactionId, scope)
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    return NextResponse.json({
      transactionId: transaction.id,
      paymentId: transaction.paymentId,
      providerKey: transaction.providerKey,
      sessionId: transaction.providerSessionId,
      status: transaction.unifiedStatus,
      gatewayStatus: transaction.gatewayStatus,
      amount: Number(transaction.amount),
      amountReceived: null,
      currencyCode: transaction.currencyCode,
      redirectUrl: transaction.redirectUrl,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = getStatusSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }
  const actorUserId = auth.userId ?? auth.sub
  const { transactionId } = parsed.data

  try {
    const transaction = await service.findTransaction(transactionId, scope)
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: scope.organizationId,
      userId: actorUserId,
      resourceKind: gatewayTransactionResourceKind,
      resourceId: transactionId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const status = await service.getPaymentStatus(transactionId, scope)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: scope.organizationId,
        userId: actorUserId,
        resourceKind: gatewayTransactionResourceKind,
        resourceId: transactionId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

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
    const message = err instanceof Error ? err.message : 'Failed to refresh status'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Payment transaction status',
  methods: {
    GET: {
      summary: 'Get stored transaction status',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Stored transaction status' },
        { status: 400, description: 'Missing or malformed transactionId' },
        { status: 404, description: 'Transaction not found' },
      ],
    },
    POST: {
      summary: 'Refresh transaction status from the provider',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Refreshed transaction status' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Transaction not found' },
        { status: 422, description: 'Missing or malformed payload' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
