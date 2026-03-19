import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import { GatewayTransaction } from '../../data/entities'
import { listTransactionsQuerySchema } from '../../data/validators'
import {
  listGatewayTransactionAssignments,
  readPrimaryGatewayTransactionAssignment,
} from '../../lib/transaction-assignments'
import { paymentGatewaysTag } from '../openapi'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/gateway_transaction'

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

  const { page, pageSize, search, providerKey, status, entityType, entityId, documentType, documentId } = parsed.data
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const queryEngine = resolve('queryEngine') as QueryEngine
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }
  const resolvedEntityType = entityType ?? documentType ?? null
  const resolvedEntityId = entityId ?? documentId ?? null

  let searchedIds: string[] | null = null
  if (search) {
    const qb = em.createQueryBuilder(GatewayTransaction, 'gt')
    qb.select('gt.id')
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
    if (resolvedEntityType || resolvedEntityId) {
      const clauses = [
        'gta.transaction_id = gt.id',
        'gta.organization_id = ?',
        'gta.tenant_id = ?',
      ]
      const params: Array<string> = [auth.orgId as string, auth.tenantId]
      if (resolvedEntityType) {
        clauses.push('gta.entity_type = ?')
        params.push(resolvedEntityType)
      }
      if (resolvedEntityId) {
        clauses.push('gta.entity_id = ?')
        params.push(resolvedEntityId)
      }
      qb.andWhere(
        `exists (
          select 1
          from gateway_transaction_assignments as gta
          where ${clauses.join('\n            and ')}
        )`,
        params,
      )
    }

    const pattern = `%${escapeLikePattern(search)}%`
    qb.andWhere(`(
      cast(gt.id as text) ilike ?
      or cast(gt.payment_id as text) ilike ?
      or coalesce(gt.provider_key, '') ilike ?
      or coalesce(gt.provider_session_id, '') ilike ?
      or coalesce(gt.gateway_payment_id, '') ilike ?
      or coalesce(gt.gateway_refund_id, '') ilike ?
    ) escape '\\'`, [pattern, pattern, pattern, pattern, pattern, pattern])

    const rows = await qb.execute<Array<{ id: string }>>()
    searchedIds = rows.map((row) => row.id).filter((value) => typeof value === 'string' && value.length > 0)
    if (searchedIds.length === 0) {
      return NextResponse.json({
        items: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      })
    }
  }

  const filters: Record<string, unknown> = {}
  if (providerKey) {
    filters[F.provider_key] = { $eq: providerKey }
  }
  if (status) {
    filters[F.unified_status] = { $eq: status }
  }
  if (resolvedEntityType) {
    filters['assignments.entity_type'] = { $eq: resolvedEntityType }
  }
  if (resolvedEntityId) {
    filters['assignments.entity_id'] = { $eq: resolvedEntityId }
  }
  if (searchedIds) {
    filters[F.id] = { $in: searchedIds }
  }

  const result = await queryEngine.query(E.payment_gateways.gateway_transaction, {
    fields: [
      F.id,
      F.payment_id,
      F.provider_key,
      F.provider_session_id,
      F.gateway_payment_id,
      F.gateway_refund_id,
      F.unified_status,
      F.gateway_status,
      F.amount,
      F.currency_code,
      F.redirect_url,
      F.last_webhook_at,
      F.last_polled_at,
      F.created_at,
      F.updated_at,
    ],
    filters,
    joins: [
      {
        alias: 'assignments',
        table: 'gateway_transaction_assignments',
        from: { field: 'id' },
        to: { field: 'transaction_id' },
        type: 'left',
      },
    ],
    sort: [{ field: F.created_at, dir: SortDir.Desc }],
    page: { page, pageSize },
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  const items = Array.isArray(result.items) ? result.items : []
  const assignmentsByTransaction = await listGatewayTransactionAssignments(em, {
    transactionIds: items
      .map((item) => (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
        ? (item as Record<string, unknown>).id as string
        : ''))
      .filter((value) => value.length > 0),
    scope,
  })

  return NextResponse.json({
    items: items.map((item) => ({
      id: (item as Record<string, unknown>).id,
      paymentId: (item as Record<string, unknown>).payment_id,
      providerKey: (item as Record<string, unknown>).provider_key,
      providerSessionId: (item as Record<string, unknown>).provider_session_id ?? null,
      gatewayPaymentId: (item as Record<string, unknown>).gateway_payment_id ?? null,
      gatewayRefundId: (item as Record<string, unknown>).gateway_refund_id ?? null,
      unifiedStatus: (item as Record<string, unknown>).unified_status,
      gatewayStatus: (item as Record<string, unknown>).gateway_status ?? null,
      amount: String((item as Record<string, unknown>).amount ?? ''),
      currencyCode: (item as Record<string, unknown>).currency_code,
      assignments: (() => {
        const transactionId = typeof (item as Record<string, unknown>).id === 'string'
          ? (item as Record<string, unknown>).id as string
          : ''
        return (assignmentsByTransaction.get(transactionId) ?? []).map((assignment) => ({
          id: assignment.id,
          entityType: assignment.entityType,
          entityId: assignment.entityId,
          createdAt: formatDateValue(assignment.createdAt),
        }))
      })(),
      documentType: (() => {
        const transactionId = typeof (item as Record<string, unknown>).id === 'string'
          ? (item as Record<string, unknown>).id as string
          : ''
        const assignments = assignmentsByTransaction.get(transactionId) ?? []
        const primary = readPrimaryGatewayTransactionAssignment(assignments.map((assignment) => ({
          entityType: assignment.entityType,
          entityId: assignment.entityId,
        })))
        return primary?.entityType ?? null
      })(),
      documentId: (() => {
        const transactionId = typeof (item as Record<string, unknown>).id === 'string'
          ? (item as Record<string, unknown>).id as string
          : ''
        const assignments = assignmentsByTransaction.get(transactionId) ?? []
        const primary = readPrimaryGatewayTransactionAssignment(assignments.map((assignment) => ({
          entityType: assignment.entityType,
          entityId: assignment.entityId,
        })))
        return primary?.entityId ?? null
      })(),
      redirectUrl: (item as Record<string, unknown>).redirect_url ?? null,
      lastWebhookAt: formatDateValue((item as Record<string, unknown>).last_webhook_at),
      lastPolledAt: formatDateValue((item as Record<string, unknown>).last_polled_at),
      createdAt: formatDateValue((item as Record<string, unknown>).created_at),
      updatedAt: formatDateValue((item as Record<string, unknown>).updated_at),
    })),
    total: result.total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
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
