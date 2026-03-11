import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { IntegrationLogService } from '../../../../integrations/lib/log-service'
import { GatewayTransaction } from '../../../data/entities'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  path: '/payment_gateways/transactions/[id]',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

function toIsoString(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return value
  }
  const parsed = new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolvedParams = await params
  const transactionId = resolvedParams?.id
  if (!transactionId) {
    return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }
  const em = resolve('em') as EntityManager
  const integrationLogService = resolve('integrationLogService') as IntegrationLogService
  const transaction = await findOneWithDecryption(
    em,
    GatewayTransaction,
    {
      id: transactionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )

  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const integrationId = `gateway_${transaction.providerKey}`
  const { items: logRows } = await integrationLogService.query(
    {
      integrationId,
      entityType: 'payment_transaction',
      entityId: transactionId,
      page: 1,
      pageSize: 100,
    },
    scope,
  )

  return NextResponse.json({
    transaction: {
      id: transaction.id,
      paymentId: transaction.paymentId,
      providerKey: transaction.providerKey,
      providerSessionId: transaction.providerSessionId ?? null,
      gatewayPaymentId: transaction.gatewayPaymentId ?? null,
      gatewayRefundId: transaction.gatewayRefundId ?? null,
      unifiedStatus: transaction.unifiedStatus,
      gatewayStatus: transaction.gatewayStatus ?? null,
      redirectUrl: transaction.redirectUrl ?? null,
      amount: transaction.amount,
      currencyCode: transaction.currencyCode,
      gatewayMetadata: transaction.gatewayMetadata ?? null,
      webhookLog: Array.isArray(transaction.webhookLog) ? transaction.webhookLog : [],
      lastWebhookAt: toIsoString(transaction.lastWebhookAt),
      lastPolledAt: toIsoString(transaction.lastPolledAt),
      expiresAt: toIsoString(transaction.expiresAt),
      createdAt: toIsoString(transaction.createdAt),
      updatedAt: toIsoString(transaction.updatedAt),
    },
    logs: logRows.map((row) => ({
      id: row.id,
      integrationId: row.integrationId,
      runId: row.runId ?? null,
      scopeEntityType: row.scopeEntityType ?? null,
      scopeEntityId: row.scopeEntityId ?? null,
      level: row.level,
      message: row.message,
      code: row.code ?? null,
      payload: row.payload ?? null,
      createdAt: toIsoString(row.createdAt),
    })),
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Get payment transaction details',
  methods: {
    GET: {
      summary: 'Get payment transaction details',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment transaction details' },
        { status: 404, description: 'Transaction not found' },
      ],
    },
  },
}

export default GET
