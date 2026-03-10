/**
 * Catalog Image Enricher
 *
 * Overrides the snapshot's `thumbnailUrl` with the current product/variant image
 * at API response time. The snapshot serves as fallback for deleted products.
 *
 * Uses batch queries via `enrichMany` to prevent N+1.
 */

import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { CatalogProduct, CatalogProductVariant } from '../../catalog/data/entities'

type LineRecord = Record<string, unknown> & { id: string }

type CatalogSnapshot = {
  product?: { thumbnailUrl?: string | null; [key: string]: unknown }
  variant?: { thumbnailUrl?: string | null; [key: string]: unknown }
  [key: string]: unknown
}

function parseSnapshot(raw: unknown): CatalogSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as CatalogSnapshot
}

function collectProductIds(records: LineRecord[]): {
  productIds: Set<string>
  variantIds: Set<string>
} {
  const productIds = new Set<string>()
  const variantIds = new Set<string>()
  for (const record of records) {
    const productId = record['product_id'] ?? record['productId']
    const variantId = record['product_variant_id'] ?? record['productVariantId']
    if (typeof productId === 'string') productIds.add(productId)
    if (typeof variantId === 'string') variantIds.add(variantId)
  }
  return { productIds, variantIds }
}

async function fetchCurrentMediaUrls(
  em: unknown,
  productIds: Set<string>,
  variantIds: Set<string>,
  organizationId: string,
): Promise<{
  productMedia: Map<string, string | null>
  variantMedia: Map<string, string | null>
}> {
  const fork = (em as any).fork()
  const productMedia = new Map<string, string | null>()
  const variantMedia = new Map<string, string | null>()

  if (productIds.size > 0) {
    const products: Array<{ id: string; defaultMediaUrl?: string | null }> = await fork.find(
      CatalogProduct,
      { id: { $in: [...productIds] }, organizationId, deletedAt: null },
      { fields: ['id', 'defaultMediaUrl'] },
    )
    for (const product of products) {
      productMedia.set(product.id, product.defaultMediaUrl ?? null)
    }
  }

  if (variantIds.size > 0) {
    const variants: Array<{ id: string; defaultMediaUrl?: string | null }> = await fork.find(
      CatalogProductVariant,
      { id: { $in: [...variantIds] }, organizationId, deletedAt: null },
      { fields: ['id', 'defaultMediaUrl'] },
    )
    for (const variant of variants) {
      variantMedia.set(variant.id, variant.defaultMediaUrl ?? null)
    }
  }

  return { productMedia, variantMedia }
}

function applyMediaToRecord(
  record: LineRecord,
  productMedia: Map<string, string | null>,
  variantMedia: Map<string, string | null>,
): LineRecord {
  const snapshotKey = 'catalog_snapshot' in record ? 'catalog_snapshot' : 'catalogSnapshot'
  const snapshot = parseSnapshot(record[snapshotKey])
  if (!snapshot) return record

  const productId = (record['product_id'] ?? record['productId']) as string | undefined
  const variantId = (record['product_variant_id'] ?? record['productVariantId']) as string | undefined

  let changed = false
  const updatedSnapshot = { ...snapshot }

  if (productId && productMedia.has(productId) && snapshot.product) {
    updatedSnapshot.product = { ...snapshot.product, thumbnailUrl: productMedia.get(productId) ?? snapshot.product.thumbnailUrl }
    changed = true
  }

  if (variantId && variantMedia.has(variantId) && snapshot.variant) {
    updatedSnapshot.variant = { ...snapshot.variant, thumbnailUrl: variantMedia.get(variantId) ?? snapshot.variant.thumbnailUrl }
    changed = true
  }

  if (!changed) return record
  return { ...record, [snapshotKey]: updatedSnapshot }
}

const catalogImageEnricher: ResponseEnricher<LineRecord> = {
  id: 'sales.catalog-image',
  targetEntity: '*',
  features: ['sales.quotes.view'],
  priority: 5,
  timeout: 1000,
  critical: false,
  fallback: {},

  async enrichOne(record, context: EnricherContext) {
    const { productIds, variantIds } = collectProductIds([record])
    if (productIds.size === 0 && variantIds.size === 0) return record

    const { productMedia, variantMedia } = await fetchCurrentMediaUrls(
      context.em,
      productIds,
      variantIds,
      context.organizationId,
    )

    return applyMediaToRecord(record, productMedia, variantMedia)
  },

  async enrichMany(records, context: EnricherContext) {
    if (records.length === 0) return records

    const { productIds, variantIds } = collectProductIds(records)
    if (productIds.size === 0 && variantIds.size === 0) return records

    const { productMedia, variantMedia } = await fetchCurrentMediaUrls(
      context.em,
      productIds,
      variantIds,
      context.organizationId,
    )

    return records.map((record) => applyMediaToRecord(record, productMedia, variantMedia))
  },
}

export const enrichers: ResponseEnricher[] = [catalogImageEnricher]
