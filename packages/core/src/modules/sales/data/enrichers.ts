/**
 * Catalog Image Enricher
 *
 * Overrides the snapshot's `thumbnailUrl` with a freshly built URL from the
 * product/variant's current `defaultMediaId`. This ensures quote/order lines
 * always reflect the latest product image, even when the underlying attachment
 * changes. The snapshot serves as fallback for deleted products.
 *
 * Uses raw Knex queries because cross-module ORM entity class references
 * do not resolve correctly at runtime (the imported class does not match the
 * entity registered in MikroORM's metadata by the app bootstrap).
 */

import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { buildAttachmentImageUrl } from '../../attachments/lib/imageUrls'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'

type LineRecord = Record<string, unknown> & { id: string }

type SnapshotNode = { thumbnailUrl?: string | null; [key: string]: unknown }
type CatalogSnapshot = { product?: SnapshotNode; variant?: SnapshotNode; [key: string]: unknown }

function getKnex(em: unknown): unknown {
  return (em as any).getConnection?.()?.getKnex?.()
}

async function fetchMediaIds(
  knex: unknown,
  table: string,
  ids: Set<string>,
  organizationId: string,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (ids.size === 0) return map

  const rows: Array<{ id: string; default_media_id: string | null }> = await (knex as any)(table)
    .select('id', 'default_media_id')
    .whereIn('id', [...ids])
    .where('organization_id', organizationId)
    .whereNull('deleted_at')

  for (const row of rows) {
    map.set(row.id, row.default_media_id ? buildAttachmentImageUrl(row.default_media_id) : null)
  }
  return map
}

function enrichRecords(
  records: LineRecord[],
  productMedia: Map<string, string | null>,
  variantMedia: Map<string, string | null>,
): LineRecord[] {
  return records.map((record) => {
    const productId = record['product_id'] as string | undefined
    const variantId = record['product_variant_id'] as string | undefined

    const productUrl = productId ? productMedia.get(productId) : undefined
    const variantUrl = variantId ? variantMedia.get(variantId) : undefined
    if (productUrl === undefined && variantUrl === undefined) return record

    const snapshot = (record['catalog_snapshot'] as CatalogSnapshot | null | undefined) ?? {}
    const updatedSnapshot = { ...snapshot }

    if (productUrl !== undefined) {
      updatedSnapshot.product = { ...snapshot.product, thumbnailUrl: productUrl ?? snapshot.product?.thumbnailUrl }
    }
    if (variantUrl !== undefined) {
      updatedSnapshot.variant = { ...snapshot.variant, thumbnailUrl: variantUrl ?? snapshot.variant?.thumbnailUrl }
    }

    const changed =
      updatedSnapshot.product?.thumbnailUrl !== snapshot.product?.thumbnailUrl ||
      updatedSnapshot.variant?.thumbnailUrl !== snapshot.variant?.thumbnailUrl
    if (!changed) return record

    return { ...record, catalog_snapshot: updatedSnapshot }
  })
}

function createCatalogImageEnricher(targetEntity: string): ResponseEnricher<LineRecord> {
  return {
    id: `sales.catalog-image:${targetEntity}`,
    targetEntity,
    features: [],
    priority: 5,
    timeout: 1000,
    critical: false,
    fallback: {},

    async enrichOne(record, context: EnricherContext) {
      return (await this.enrichMany!([record], context))[0]
    },

    async enrichMany(records, context: EnricherContext) {
      if (records.length === 0) return records

      const knex = getKnex(context.em)
      if (!knex) return records

      const productIds = new Set<string>()
      const variantIds = new Set<string>()
      for (const record of records) {
        if (typeof record['product_id'] === 'string') productIds.add(record['product_id'])
        if (typeof record['product_variant_id'] === 'string') variantIds.add(record['product_variant_id'])
      }
      if (productIds.size === 0 && variantIds.size === 0) return records

      const [productMedia, variantMedia] = await Promise.all([
        fetchMediaIds(knex, 'catalog_products', productIds, context.organizationId),
        fetchMediaIds(knex, 'catalog_product_variants', variantIds, context.organizationId),
      ])

      return enrichRecords(records, productMedia, variantMedia)
    },
  }
}

// --- Sales Customer Metrics Enricher ---

type EntityRecord = Record<string, unknown> & { id: string }
type EnricherScope = EnricherContext & { container: { resolve(name: string): unknown } }

type SalesEnrichment = {
  _sales: {
    orderCount: number
    totalRevenue: number
    lastOrderDate: string | null
    averageOrderValue: number
  }
}

type OrderRecord = {
  id: string
  total_amount?: string | number | null
  created_at?: string | null
  customer_entity_id?: string | null
}

const SALES_ORDER_ENTITY = 'sales:sales_order' as EntityId

const FALLBACK: SalesEnrichment = {
  _sales: {
    orderCount: 0,
    totalRevenue: 0,
    lastOrderDate: null,
    averageOrderValue: 0,
  },
}

const salesCustomerEnricher: ResponseEnricher<EntityRecord, SalesEnrichment> = {
  id: 'sales.customer-metrics',
  targetEntity: 'customers.company',
  features: ['sales.orders.view'],
  priority: 5,
  timeout: 2000,
  critical: false,
  fallback: FALLBACK,

  async enrichOne(record, context: EnricherScope) {
    const queryEngine = context.container?.resolve('queryEngine') as QueryEngine | undefined
    if (!queryEngine) return { ...record, ...FALLBACK }

    try {
      const result = await queryEngine.query<OrderRecord>(SALES_ORDER_ENTITY, {
        tenantId: context.tenantId ?? null,
        organizationIds: context.organizationId ? [context.organizationId] : undefined,
        filters: {
          customer_entity_id: { $eq: record.id },
        },
        page: { page: 1, pageSize: 1000 },
        sort: [{ field: 'created_at', dir: SortDir.Desc }],
      })

      const orders = result.items ?? []
      let totalRevenue = 0
      let lastOrderDate: string | null = null

      for (const order of orders) {
        const amount = typeof order.total_amount === 'string'
          ? parseFloat(order.total_amount)
          : (order.total_amount ?? 0)
        if (!Number.isNaN(amount)) totalRevenue += amount
        if (order.created_at) {
          if (!lastOrderDate || order.created_at > lastOrderDate) {
            lastOrderDate = order.created_at
          }
        }
      }

      const orderCount = orders.length
      return {
        ...record,
        _sales: {
          orderCount,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          lastOrderDate,
          averageOrderValue: orderCount > 0 ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0,
        },
      }
    } catch {
      return { ...record, ...FALLBACK }
    }
  },

  async enrichMany(records, context: EnricherScope) {
    const queryEngine = context.container?.resolve('queryEngine') as QueryEngine | undefined
    if (!queryEngine) return records.map((r) => ({ ...r, ...FALLBACK }))

    const ids = records.map((r) => r.id)
    const metricsMap = new Map<string, SalesEnrichment['_sales']>()

    try {
      const result = await queryEngine.query<OrderRecord>(SALES_ORDER_ENTITY, {
        tenantId: context.tenantId ?? null,
        organizationIds: context.organizationId ? [context.organizationId] : undefined,
        filters: {
          customer_entity_id: { $in: ids },
        },
        page: { page: 1, pageSize: 5000 },
        sort: [{ field: 'created_at', dir: SortDir.Desc }],
      })

      for (const order of result.items ?? []) {
        const customerId = order.customer_entity_id
        if (!customerId) continue

        let metrics = metricsMap.get(customerId)
        if (!metrics) {
          metrics = { orderCount: 0, totalRevenue: 0, lastOrderDate: null, averageOrderValue: 0 }
          metricsMap.set(customerId, metrics)
        }

        metrics.orderCount++
        const amount = typeof order.total_amount === 'string'
          ? parseFloat(order.total_amount)
          : (order.total_amount ?? 0)
        if (!Number.isNaN(amount)) metrics.totalRevenue += amount
        if (order.created_at) {
          if (!metrics.lastOrderDate || order.created_at > metrics.lastOrderDate) {
            metrics.lastOrderDate = order.created_at
          }
        }
      }

      for (const metrics of metricsMap.values()) {
        metrics.totalRevenue = Math.round(metrics.totalRevenue * 100) / 100
        metrics.averageOrderValue = metrics.orderCount > 0
          ? Math.round((metrics.totalRevenue / metrics.orderCount) * 100) / 100
          : 0
      }
    } catch {
      // Sales module query failed — return fallback for all
    }

    return records.map((r) => ({
      ...r,
      _sales: metricsMap.get(r.id) ?? FALLBACK._sales,
    }))
  },
}

export const enrichers: ResponseEnricher[] = [
  createCatalogImageEnricher('sales:sales_quote_line'),
  createCatalogImageEnricher('sales:sales_order_line'),
  salesCustomerEnricher,
]
