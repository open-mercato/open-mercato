import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GatewayPaymentLink } from '@open-mercato/pay-by-links/modules/payment_link_pages/data/entities'
import { listPaymentLinksQuerySchema } from '@open-mercato/pay-by-links/modules/payment_link_pages/data/validators'
import { paymentGatewaysTag } from '@open-mercato/core/modules/payment_gateways/api/openapi'

export const metadata = {
  path: '/payment_gateways/payment-links',
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
  return null
}

function extractAmountFromMetadata(meta: Record<string, unknown> | null | undefined): number | null {
  if (!meta) return null
  if (typeof meta.amount === 'number') return meta.amount
  return null
}

function extractCurrencyFromMetadata(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  if (typeof meta.currencyCode === 'string') return meta.currencyCode
  return null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listPaymentLinksQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const { page, pageSize, search, providerKey, status } = parsed.data
  const offset = (page - 1) * pageSize
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const qb = em.createQueryBuilder(GatewayPaymentLink, 'pl')

  qb.where({
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })

  if (providerKey) {
    qb.andWhere({ providerKey })
  }
  if (status) {
    qb.andWhere({ status })
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    qb.andWhere(`(
      pl.token ilike ?
      or pl.title ilike ?
      or coalesce(pl.description, '') ilike ?
    ) escape '\\'`, [pattern, pattern, pattern])
  }

  const countQb = qb.clone()
  qb.orderBy({ createdAt: 'desc' })
  qb.limit(pageSize).offset(offset)

  const [items, total] = await Promise.all([
    qb.getResultList(),
    countQb.count('pl.id', true),
  ])

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      token: item.token,
      title: item.title,
      description: item.description ?? null,
      providerKey: item.providerKey,
      status: item.status,
      transactionId: item.transactionId ?? null,
      amount: extractAmountFromMetadata(item.metadata),
      currencyCode: extractCurrencyFromMetadata(item.metadata),
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
  summary: 'List payment links',
  methods: {
    GET: {
      summary: 'List payment links',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment link list' },
      ],
    },
  },
}

export default GET
