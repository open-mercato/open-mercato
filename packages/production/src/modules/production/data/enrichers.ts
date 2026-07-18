import type { EntityManager } from '@mikro-orm/postgresql'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { ProductionOrder } from './entities.js'

/**
 * Response enricher federating production-order status onto sales order API
 * responses (spec § Sales integration — soft coupling via response
 * enricher, never a direct ORM relation). Gated by `production.orders.view`
 * so a caller without that feature (including every portal/customer-facing
 * request, which never carries a `production.*` feature grant) gets the
 * `fallback: null` value instead of `_production` data — enforcement is the
 * platform's existing enricher ACL gate (`ResponseEnricher.features`), not
 * anything this module re-implements.
 */
type SalesOrderRecord = Record<string, unknown> & { id?: string }

type EnrichedProductionOrder = {
  id: string
  number: number
  status: string
  qtyPlanned: string
  qtyCompleted: string
}

const productionOrdersStatusEnricher: ResponseEnricher<SalesOrderRecord, { _production: { orders: EnrichedProductionOrder[] } | null }> = {
  id: 'production.orders-status',
  targetEntity: 'sales:sales_order',
  features: ['production.orders.view'],
  priority: 30,
  timeout: 2000,
  critical: false,
  fallback: { _production: null },
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context) {
    const orderIds = Array.from(
      new Set(records.map((record) => (typeof record.id === 'string' ? record.id : null)).filter((value): value is string => Boolean(value))),
    )
    if (!orderIds.length) return records.map((record) => ({ ...record, _production: null }))

    const em = context.em as EntityManager
    const rows = await em.find(ProductionOrder, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      sourceType: 'sales_order',
      sourceId: { $in: orderIds },
      deletedAt: null,
    })

    const ordersBySourceId = new Map<string, EnrichedProductionOrder[]>()
    for (const row of rows) {
      const sourceId = row.sourceId
      if (!sourceId) continue
      const bucket = ordersBySourceId.get(sourceId) ?? []
      bucket.push({
        id: row.id,
        number: row.number,
        status: row.status,
        qtyPlanned: row.qtyPlanned,
        qtyCompleted: row.qtyCompleted,
      })
      ordersBySourceId.set(sourceId, bucket)
    }

    return records.map((record) => {
      const id = typeof record.id === 'string' ? record.id : null
      const orders = id ? ordersBySourceId.get(id) ?? null : null
      return {
        ...record,
        _production: orders && orders.length ? { orders } : null,
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [productionOrdersStatusEnricher]
