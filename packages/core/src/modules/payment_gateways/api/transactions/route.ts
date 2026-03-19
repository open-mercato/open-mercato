import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GatewayTransaction } from '../../data/entities'
import { listTransactionsQuerySchema } from '../../data/validators'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/transactions',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function formatDateValue(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return value
  }
  const fallback = new Date(value as string | number)
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString()
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listTransactionsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const { page, pageSize, search, providerKey, status } = parsed.data
  const offset = (page - 1) * pageSize
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const qb = em.createQueryBuilder(GatewayTransaction, 'gt')

  qb.where({
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })

  if (providerKey) {
    qb.andWhere({ providerKey })
  }
  if (status) {
    qb.andWhere({ unifiedStatus: status })
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    qb.andWhere(`(
      cast(gt.id as text) ilike ?
      or cast(gt.payment_id as text) ilike ?
      or coalesce(gt.provider_key, '') ilike ?
      or coalesce(gt.provider_session_id, '') ilike ?
      or coalesce(gt.gateway_payment_id, '') ilike ?
      or coalesce(gt.gateway_refund_id, '') ilike ?
    ) escape '\\'`, [pattern, pattern, pattern, pattern, pattern, pattern])
  }

  const countQb = qb.clone()
  qb.orderBy({ createdAt: 'desc' })
  qb.limit(pageSize).offset(offset)

  const [items, total] = await Promise.all([
    qb.getResultList(),
    countQb.count('gt.id', true),
  ])

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      paymentId: item.paymentId,
      providerKey: item.providerKey,
      providerSessionId: item.providerSessionId ?? null,
      gatewayPaymentId: item.gatewayPaymentId ?? null,
      gatewayRefundId: item.gatewayRefundId ?? null,
      unifiedStatus: item.unifiedStatus,
      gatewayStatus: item.gatewayStatus ?? null,
      amount: item.amount,
      currencyCode: item.currencyCode,
      redirectUrl: item.redirectUrl ?? null,
      lastWebhookAt: formatDateValue(item.lastWebhookAt),
      lastPolledAt: formatDateValue(item.lastPolledAt),
      createdAt: formatDateValue(item.createdAt),
      updatedAt: formatDateValue(item.updatedAt),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'List payment transactions',
  methods: {
    GET: {
      summary: 'List payment transactions',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment transaction list' },
      ],
    },
  },
}

export default GET
