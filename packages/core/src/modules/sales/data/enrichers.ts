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

export const enrichers: ResponseEnricher[] = [
  createCatalogImageEnricher('sales:sales_quote_line'),
  createCatalogImageEnricher('sales:sales_order_line'),
]
