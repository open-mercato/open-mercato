import type { AwilixContainer } from 'awilix'
import type { EcommerceStorefrontCategoryLandingQuery, EcommerceStorefrontCategoryTreeQuery } from '../data/validators'
import { catalogCategoryTag, catalogProductsTag, storefrontCache, storefrontCacheValueHash } from './cacheKeys'
import {
  getStorefrontCategoryLanding,
  getStorefrontCategoryTree,
  type StorefrontCategoryLandingBlock,
  type StorefrontCategoryTreeResponse,
} from './storefrontCategories'
import { cachedListStorefrontProducts } from './storefrontProductCache'
import type { StorefrontProductListResponse } from './storefrontProducts'
import type { StoreContext } from './types'

/**
 * Server-side cache for `GET /categories` and `GET /categories/:slug` (Storefront Public API rev 4
 * §9). Neither response carries a price, so the tree and the landing's category block are keyed on
 * `assortmentScopeHash` (`scope: 'assortment'`: store, effective locale, hash) and shared by every
 * buyer with the same effective assortment. The landing's embedded `/products` response is
 * buyer-priced: it goes through `cachedListStorefrontProducts` on the full digest, and shares its
 * entry with an identical `GET /products?categoryId=…` request.
 *
 * A cached category block is only ever stored for a category visible under that assortment, so a
 * hit never needs the visibility check again; a miss that resolves to nothing is never cached, so
 * a 404 costs the same on every request. Entries carry the tenant's `catalog-products` tag, which
 * every category, product and price event evicts, plus the landing category's own tag.
 */

export const STOREFRONT_CATEGORY_TREE_TTL_MS = 300_000
export const STOREFRONT_CATEGORY_LANDING_TTL_MS = 60_000

const TREE_CACHE_SEGMENT = 'categories-tree'
const LANDING_CACHE_SEGMENT = 'categories-landing'
const RESOLUTION_ONLY_PARAMETERS: ReadonlySet<string> = new Set(['path', 'storeSlug', 'locale'])

export function storefrontCategoryTreeCacheParts(
  query: Pick<EcommerceStorefrontCategoryTreeQuery, 'parentId' | 'depth' | 'includeEmpty'>,
): string[] {
  const relevant = Object.fromEntries(
    Object.entries(query).filter(([key]) => !RESOLUTION_ONLY_PARAMETERS.has(key)),
  )
  return [TREE_CACHE_SEGMENT, storefrontCacheValueHash(relevant)]
}

export function storefrontCategoryLandingCacheParts(slug: string): string[] {
  return [LANDING_CACHE_SEGMENT, slug.trim()]
}

export function storefrontCategoryTreeCacheTags(ctx: StoreContext): string[] {
  return [catalogProductsTag(ctx.tenantId)]
}

export function storefrontCategoryLandingCacheTags(ctx: StoreContext, block: StorefrontCategoryLandingBlock): string[] {
  return [catalogProductsTag(ctx.tenantId), catalogCategoryTag(block.category.id)]
}

export async function cachedGetStorefrontCategoryTree(
  container: AwilixContainer,
  ctx: StoreContext,
  query: Pick<EcommerceStorefrontCategoryTreeQuery, 'parentId' | 'depth' | 'includeEmpty'>,
): Promise<StorefrontCategoryTreeResponse> {
  const cache = storefrontCache(container, ctx)
  const parts = storefrontCategoryTreeCacheParts(query)
  const cached = await cache.get<StorefrontCategoryTreeResponse>(parts, { scope: 'assortment' })
  if (cached) return cached
  const response = await getStorefrontCategoryTree(container, ctx, query)
  await cache.set(parts, response, {
    scope: 'assortment',
    ttlMs: STOREFRONT_CATEGORY_TREE_TTL_MS,
    tags: storefrontCategoryTreeCacheTags(ctx),
  })
  return response
}

export type StorefrontCategoryLandingResponse = StorefrontCategoryLandingBlock & {
  products: StorefrontProductListResponse
}

async function cachedGetStorefrontCategoryBlock(
  container: AwilixContainer,
  ctx: StoreContext,
  slug: string,
): Promise<StorefrontCategoryLandingBlock | null> {
  const cache = storefrontCache(container, ctx)
  const parts = storefrontCategoryLandingCacheParts(slug)
  const cached = await cache.get<StorefrontCategoryLandingBlock>(parts, { scope: 'assortment' })
  if (cached) return cached
  const block = await getStorefrontCategoryLanding(container, ctx, slug)
  if (!block) return null
  await cache.set(parts, block, {
    scope: 'assortment',
    ttlMs: STOREFRONT_CATEGORY_LANDING_TTL_MS,
    tags: storefrontCategoryLandingCacheTags(ctx, block),
  })
  return block
}

/**
 * `null` when no visible category has this slug — and nothing about the embedded listing is touched
 * then — or when the listing no longer resolves the category (it went inactive between the cached
 * block and the listing), so a landing can never serve an unfiltered catalogue.
 */
export async function cachedGetStorefrontCategoryLanding(
  container: AwilixContainer,
  ctx: StoreContext,
  slug: string,
  query: EcommerceStorefrontCategoryLandingQuery,
): Promise<StorefrontCategoryLandingResponse | null> {
  const block = await cachedGetStorefrontCategoryBlock(container, ctx, slug)
  if (!block) return null
  const products = await cachedListStorefrontProducts(container, ctx, { ...query, categoryId: block.category.id })
  if (products.appliedFilters.category?.id !== block.category.id) return null
  return { ...block, products }
}
