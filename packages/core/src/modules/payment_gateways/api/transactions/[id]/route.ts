import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GatewayTransaction } from '../../../data/entities'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
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
  const em = resolve('em') as EntityManager
  const transaction = await em.findOne(GatewayTransaction, {
    id: transactionId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })

  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const integrationId = `gateway_${transaction.providerKey}`
  const knex = (em as unknown as { getConnection: () => { getKnex: () => any } }).getConnection().getKnex()
  const logRows = await knex('integration_logs')
    .select([
      'id',
      'integration_id as integrationId',
      'run_id as runId',
      'scope_entity_type as scopeEntityType',
      'scope_entity_id as scopeEntityId',
      'level',
      'message',
      'code',
      'payload',
      'created_at as createdAt',
    ])
    .where({
      organization_id: auth.orgId,
      tenant_id: auth.tenantId,
      integration_id: integrationId,
    })
    .andWhere((builder: any) => {
      builder
        .where({
          scope_entity_type: 'payment_transaction',
          scope_entity_id: transactionId,
        })
        .orWhereRaw(`payload->>'transactionId' = ?`, [transactionId])
    })
    .orderBy('created_at', 'desc')
    .limit(100)

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
    logs: logRows.map((row: Record<string, unknown>) => ({
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
