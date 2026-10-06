import type { AwilixContainer } from 'awilix'
import type { EcommerceStorefrontProductListQuery } from '../data/validators'
import {
  catalogCategoryTag,
  catalogPriceTag,
  catalogProductTag,
  catalogProductsTag,
  storefrontAvailabilityTag,
  storefrontCache,
  storefrontCacheValueHash,
} from './cacheKeys'
import {
  getStorefrontProductDetail,
  type GetStorefrontProductDetailOptions,
  type StorefrontProductDetail,
} from './storefrontDetail'
import { listStorefrontProducts, type StorefrontProductListResponse } from './storefrontProducts'
import type { StoreContext } from './types'

/**
 * Server-side cache for `GET /products` and `GET /products/:idOrHandle` (Storefront Public API
 * rev 4 §9). Both are keyed on the full `digest` through `storefrontCache(container, ctx)`, so two
 * buyers share an entry only when every field that changes what they see or pay is equal; the
 * HTTP layer decides separately whether a browser or CDN may keep the response.
 *
 * Invalidation (subscribers, `cacheInvalidation.ts`): listings carry the tenant's
 * `catalog-products` collection tag, evicted by every product, variant, category and price event;
 * details carry per-product, per-price and per-category tags. Anything `catalog` emits no event for
 * (tags, offers, price kinds, option schemas, a deleted variant or price whose product can no longer
 * be read back, new related products) is picked up when the entry expires — 30 s for listings,
 * 60 s for details — never on write.
 */

export const STOREFRONT_PRODUCT_LIST_TTL_MS = 30_000
export const STOREFRONT_PRODUCT_DETAIL_TTL_MS = 60_000

const LIST_CACHE_SEGMENT = 'products-list'
const DETAIL_CACHE_SEGMENT = 'products-detail'
const NULL_SEGMENT = '-'
const RESOLUTION_ONLY_PARAMETERS: ReadonlySet<string> = new Set(['path', 'storeSlug'])

/**
 * The listing's normalized query: every parsed parameter except the store-resolution ones (the
 * resolved store is already part of the key), with object keys sorted, hashed to a fixed length.
 */
export function storefrontProductListCacheParts(query: EcommerceStorefrontProductListQuery): string[] {
  const relevant = Object.fromEntries(
    Object.entries(query).filter(([key]) => !RESOLUTION_ONLY_PARAMETERS.has(key)),
  )
  return [LIST_CACHE_SEGMENT, storefrontCacheValueHash(relevant)]
}

export function storefrontProductDetailCacheParts(
  idOrHandle: string,
  options: Pick<GetStorefrontProductDetailOptions, 'variantId' | 'locale'>,
): string[] {
  return [DETAIL_CACHE_SEGMENT, idOrHandle.trim(), options.variantId ?? NULL_SEGMENT, options.locale ?? NULL_SEGMENT]
}

export function storefrontProductListCacheTags(
  ctx: StoreContext,
  response: Pick<StorefrontProductListResponse, 'appliedFilters'>,
): string[] {
  const categoryId = response.appliedFilters.category?.id
  return [
    catalogProductsTag(ctx.tenantId),
    storefrontAvailabilityTag(ctx.tenantId),
    ...(categoryId ? [catalogCategoryTag(categoryId)] : []),
  ]
}

export function storefrontProductDetailCacheTags(ctx: StoreContext, detail: StorefrontProductDetail): string[] {
  const productIds = [detail.id, ...detail.relatedProducts.map((item) => item.id)]
  const categoryIds = [
    ...detail.categories.map((category) => category.id),
    ...detail.breadcrumb.map((entry) => entry.id),
    ...detail.relatedProducts.flatMap((item) => item.categories.map((category) => category.id)),
  ]
  return Array.from(
    new Set([
      ...productIds.map(catalogProductTag),
      ...productIds.map(catalogPriceTag),
      ...categoryIds.map(catalogCategoryTag),
      storefrontAvailabilityTag(ctx.tenantId),
    ]),
  )
}

export async function cachedListStorefrontProducts(
  container: AwilixContainer,
  ctx: StoreContext,
  query: EcommerceStorefrontProductListQuery,
): Promise<StorefrontProductListResponse> {
  const cache = storefrontCache(container, ctx)
  const parts = storefrontProductListCacheParts(query)
  const cached = await cache.get<StorefrontProductListResponse>(parts, { scope: 'digest' })
  if (cached) return cached
  const response = await listStorefrontProducts(container, ctx, query)
  await cache.set(parts, response, {
    scope: 'digest',
    ttlMs: STOREFRONT_PRODUCT_LIST_TTL_MS,
    tags: storefrontProductListCacheTags(ctx, response),
  })
  return response
}

/** A `null` (not found or not visible) is never cached, so a 404 costs the same on every request. */
export async function cachedGetStorefrontProductDetail(
  container: AwilixContainer,
  ctx: StoreContext,
  idOrHandle: string,
  options: Pick<GetStorefrontProductDetailOptions, 'variantId' | 'locale'> = {},
): Promise<StorefrontProductDetail | null> {
  const cache = storefrontCache(container, ctx)
  const parts = storefrontProductDetailCacheParts(idOrHandle, options)
  const cached = await cache.get<StorefrontProductDetail>(parts, { scope: 'digest' })
  if (cached) return cached
  const detail = await getStorefrontProductDetail(container, ctx, idOrHandle, options)
  if (!detail) return null
  await cache.set(parts, detail, {
    scope: 'digest',
    ttlMs: STOREFRONT_PRODUCT_DETAIL_TTL_MS,
    tags: storefrontProductDetailCacheTags(ctx, detail),
  })
  return detail
}
