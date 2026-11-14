import type { AwilixContainer } from 'awilix'
import type { EcommerceStorefrontSearchSuggestQuery } from '../data/validators'
import { catalogProductsTag, storefrontAvailabilityTag, storefrontCache, storefrontCacheValueHash } from './cacheKeys'
import {
  normalizeStorefrontSuggestTerm,
  suggestStorefrontSearch,
  type StorefrontSearchSuggestResponse,
} from './storefrontSearch'
import type { StoreContext } from './types'

/**
 * Server-side cache for `GET /search/suggest` (Storefront Public API rev 4 §9): `formattedPrice` is
 * buyer-priced, so entries are keyed on the full `digest` plus the normalized term and `limit`.
 * They carry the tenant's `catalog-products` tag (every product, variant, category and price event)
 * and the availability tag (out-of-stock hiding). A term below the minimum length is answered
 * empty without touching the cache.
 */

export const STOREFRONT_SEARCH_SUGGEST_TTL_MS = 30_000

const SUGGEST_CACHE_SEGMENT = 'search-suggest'

export function storefrontSearchSuggestCacheParts(term: string, limit: number): string[] {
  return [SUGGEST_CACHE_SEGMENT, storefrontCacheValueHash({ term: term.toLowerCase(), limit })]
}

export function storefrontSearchSuggestCacheTags(ctx: StoreContext): string[] {
  return [catalogProductsTag(ctx.tenantId), storefrontAvailabilityTag(ctx.tenantId)]
}

export async function cachedSuggestStorefrontSearch(
  container: AwilixContainer,
  ctx: StoreContext,
  query: Pick<EcommerceStorefrontSearchSuggestQuery, 'q' | 'limit'>,
): Promise<StorefrontSearchSuggestResponse> {
  const term = normalizeStorefrontSuggestTerm(query.q)
  if (!term) return suggestStorefrontSearch(container, ctx, query)
  const cache = storefrontCache(container, ctx)
  const parts = storefrontSearchSuggestCacheParts(term, query.limit)
  const cached = await cache.get<StorefrontSearchSuggestResponse>(parts, { scope: 'digest' })
  if (cached) return cached
  const response = await suggestStorefrontSearch(container, ctx, { q: term, limit: query.limit })
  await cache.set(parts, response, {
    scope: 'digest',
    ttlMs: STOREFRONT_SEARCH_SUGGEST_TTL_MS,
    tags: storefrontSearchSuggestCacheTags(ctx),
  })
  return response
}
