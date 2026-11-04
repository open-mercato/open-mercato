import { createHash } from 'node:crypto'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { BuyerContext, StoreContext } from './types'

/**
 * The ONLY file in the ecommerce module allowed to resolve the DI `cache` (SPEC-029 §6.1
 * "Enforcement", D7). Every storefront key is built by `buildStorefrontCacheKey`; callers pass
 * `parts`, never a raw key. `__tests__/no-raw-cache-access.test.ts` fails on any other access.
 */

export type StorefrontCacheScope = 'digest' | 'assortment' | 'priceScope' | 'store'

export type StorefrontCacheKeyOptions = { scope?: StorefrontCacheScope }

export type StorefrontCacheSetOptions = {
  ttlMs: number
  tags?: string[]
  scope?: StorefrontCacheScope
}

export type StorefrontCache = {
  get<T>(parts: string[], options?: StorefrontCacheKeyOptions): Promise<T | null>
  set<T>(parts: string[], value: T, options: StorefrontCacheSetOptions): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

export type EcommerceResolutionCacheSetOptions = { ttlMs: number; tags?: string[] }

/**
 * Store-resolution cache (host/slug → store + default channel binding, §8.1 steps 3–5). It runs
 * BEFORE a `StoreContext` exists, so it is tenant-agnostic and MUST NEVER carry buyer data.
 */
export type EcommerceResolutionCache = {
  get<T>(parts: string[]): Promise<T | null>
  set<T>(parts: string[], value: T, options: EcommerceResolutionCacheSetOptions): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

/**
 * Buyer-context cache (§8, step 6): one entry per (store, customerUserId | anonymous), holding the
 * locale-independent buyer layer only. Tagged per store, per portal user, per identity in
 * `customerIds` and per contributing group so user, membership, terms, group and price events can
 * evict it.
 */
export type BuyerContextCache = {
  get(customerUserId: string | null): Promise<BuyerContext | null>
  set(buyer: BuyerContext): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

export type BuyerContextCacheScope = { tenantId: string; storeId: string }

export type CacheContainer = { resolve: (name: string) => unknown }

export const BUYER_CONTEXT_TTL_MS = 60_000

const STOREFRONT_KEY_NAMESPACE = 'ecommerce:storefront'
const RESOLUTION_KEY_NAMESPACE = 'ecommerce:resolution'
const BUYER_KEY_NAMESPACE = 'ecommerce:buyer'
const ANONYMOUS_SEGMENT = 'anonymous'
const NULL_SEGMENT = '-'

const SCOPE_SEGMENTS: Record<StorefrontCacheScope, string> = {
  digest: 'digest',
  assortment: 'assortment',
  priceScope: 'price-scope',
  store: 'store',
}

const logger = createLogger('ecommerce').child({ component: 'storefront-cache' })

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function encodeParts(parts: string[]): string {
  if (parts.length === 0) {
    throw new Error('[internal] ecommerce cache keys require at least one part')
  }
  return parts.map(encodeSegment).join(':')
}

function scopeSegments(ctx: StoreContext, scope: StorefrontCacheScope): string[] {
  const storeId = ctx.store.id
  switch (scope) {
    case 'digest':
      return [storeId, ctx.digest]
    case 'assortment':
      return [storeId, ctx.effectiveLocale, ctx.buyer.assortmentScopeHash]
    case 'priceScope':
      return [storeId, ctx.buyer.priceScopeKey, ctx.buyer.customerOverlayId ?? NULL_SEGMENT]
    case 'store':
      return [storeId, ctx.effectiveLocale]
  }
}

export function buildStorefrontCacheKey(
  ctx: StoreContext,
  parts: string[],
  options?: StorefrontCacheKeyOptions,
): string {
  const scope = options?.scope ?? 'digest'
  const prefix = [SCOPE_SEGMENTS[scope], ...scopeSegments(ctx, scope).map(encodeSegment)].join(':')
  return `${STOREFRONT_KEY_NAMESPACE}:${prefix}:${encodeParts(parts)}`
}

function canonicalCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCacheValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalCacheValue(entry)]),
    )
  }
  return value
}

/** A fixed-length key part for a structured value: object keys sorted, `undefined` entries dropped, sha256-hashed. */
export function storefrontCacheValueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalCacheValue(value))).digest('hex')
}

export function buildEcommerceResolutionCacheKey(parts: string[]): string {
  return `${RESOLUTION_KEY_NAMESPACE}:${encodeParts(parts)}`
}

export function buildBuyerContextCacheKey(storeId: string, customerUserId: string | null): string {
  return `${BUYER_KEY_NAMESPACE}:${encodeParts([storeId, customerUserId ?? ANONYMOUS_SEGMENT])}`
}

export function ecommerceStoreTag(storeId: string): string {
  return `ecommerce-store:${storeId}`
}

export function ecommerceDomainMappingTag(domainMappingId: string): string {
  return `ecommerce-domain-mapping:${domainMappingId}`
}

export function ecommerceDomainTag(hostname: string): string {
  return `ecommerce-domain:${hostname}`
}

export function ecommerceCustomerTag(customerId: string): string {
  return `customer:${customerId}`
}

/** One portal user's buyer contexts: evicted when the user is updated (e.g. deactivated) or deleted. */
export function ecommerceCustomerUserTag(customerUserId: string): string {
  return `customer-user:${customerUserId}`
}

export function ecommerceCustomerGroupTag(customerGroupId: string): string {
  return `customer-group:${customerGroupId}`
}

export function catalogProductTag(productId: string): string {
  return `catalog-product:${productId}`
}

/** Every storefront listing of a tenant: evicted by any product, variant, category or price change. */
export function catalogProductsTag(tenantId: string): string {
  return `catalog-products:${tenantId}`
}

export function catalogCategoryTag(categoryId: string): string {
  return `catalog-category:${categoryId}`
}

export function catalogPriceTag(productId: string): string {
  return `catalog-price:${productId}`
}

/** Every storefront product entry of a tenant: evicted by an availability policy not tied to one product. */
export function storefrontAvailabilityTag(tenantId: string): string {
  return `availability:${tenantId}`
}

/**
 * Buyer contexts of a tenant that resolved to no customer group (anonymous or unassigned buyers
 * while the tenant has no default group): evicted when a group is created or updated, since that
 * group may have become the default they fall back to.
 */
export function ecommerceUngroupedBuyerTag(tenantId: string): string {
  return `customer-group-none:${tenantId}`
}

export function buyerContextTags(
  buyer: Pick<BuyerContext, 'customerIds' | 'customerGroupIds'> & { customerUserId?: string | null },
  tenantId?: string,
): string[] {
  return [
    ...(buyer.customerUserId ? [ecommerceCustomerUserTag(buyer.customerUserId)] : []),
    ...buyer.customerIds.map(ecommerceCustomerTag),
    ...buyer.customerGroupIds.map(ecommerceCustomerGroupTag),
    ...(tenantId && buyer.customerGroupIds.length === 0 ? [ecommerceUngroupedBuyerTag(tenantId)] : []),
  ]
}

function resolveCacheService(container: CacheContainer | null | undefined): CacheStrategy | null {
  if (!container?.resolve) return null
  try {
    const candidate = container.resolve('cache') as CacheStrategy | null | undefined
    if (
      candidate &&
      typeof candidate.get === 'function' &&
      typeof candidate.set === 'function' &&
      typeof candidate.deleteByTags === 'function'
    ) {
      return candidate
    }
  } catch {
    return null
  }
  return null
}

function reportCacheFailure(operation: string, error: unknown): void {
  logger.warn('Ecommerce cache operation failed; degrading to a cache miss', { operation, err: error })
  getTelemetryRuntime()?.reportError(error, {
    module: 'ecommerce',
    code: 'ecommerce.cache_operation_failed',
    attributes: { operation },
  })
}

type TenantScopedCacheOptions = {
  cache: CacheStrategy | null
  tenantId: string | null
  baseTags: string[]
}

function createTenantScopedAccess({ cache, tenantId, baseTags }: TenantScopedCacheOptions) {
  return {
    async get<T>(key: string): Promise<T | null> {
      if (!cache) return null
      try {
        const value = await runWithCacheTenant(tenantId, () => cache.get(key))
        return (value ?? null) as T | null
      } catch (error) {
        reportCacheFailure('get', error)
        return null
      }
    },
    async set<T>(key: string, value: T, ttlMs: number, tags: string[] | undefined): Promise<void> {
      if (!cache) return
      const mergedTags = Array.from(new Set([...baseTags, ...(tags ?? [])]))
      try {
        await runWithCacheTenant(tenantId, () => cache.set(key, value, { ttl: ttlMs, tags: mergedTags }))
      } catch (error) {
        reportCacheFailure('set', error)
      }
    },
    async deleteByTags(tags: string[]): Promise<number> {
      if (!cache || tags.length === 0) return 0
      try {
        return await runWithCacheTenant(tenantId, () => cache.deleteByTags(tags))
      } catch (error) {
        reportCacheFailure('deleteByTags', error)
        return 0
      }
    },
  }
}

export function storefrontCache(container: CacheContainer | null | undefined, ctx: StoreContext): StorefrontCache {
  const access = createTenantScopedAccess({
    cache: resolveCacheService(container),
    tenantId: ctx.tenantId,
    baseTags: [ecommerceStoreTag(ctx.store.id)],
  })
  return {
    get: (parts, options) => access.get(buildStorefrontCacheKey(ctx, parts, options)),
    set: (parts, value, options) =>
      access.set(buildStorefrontCacheKey(ctx, parts, { scope: options.scope }), value, options.ttlMs, options.tags),
    deleteByTags: (tags) => access.deleteByTags(tags),
  }
}

export function ecommerceResolutionCache(container: CacheContainer | null | undefined): EcommerceResolutionCache {
  const access = createTenantScopedAccess({
    cache: resolveCacheService(container),
    tenantId: null,
    baseTags: [],
  })
  return {
    get: (parts) => access.get(buildEcommerceResolutionCacheKey(parts)),
    set: (parts, value, options) =>
      access.set(buildEcommerceResolutionCacheKey(parts), value, options.ttlMs, options.tags),
    deleteByTags: (tags) => access.deleteByTags(tags),
  }
}

export type EcommerceCacheInvalidation = { tenantId: string | null; tags: string[] }

/**
 * Event-driven invalidation (§8): evicts `tags` from the tenant-agnostic resolution cache and, when
 * the tenant is known, from that tenant's storefront and buyer-context caches. Tags are tenant
 * scoped by the cache layer, so each scope is cleared inside its own tenant.
 */
export async function invalidateEcommerceCacheTags(
  container: CacheContainer | null | undefined,
  invalidation: EcommerceCacheInvalidation,
): Promise<number> {
  const tags = Array.from(new Set(invalidation.tags.filter((tag) => tag.length > 0)))
  if (tags.length === 0) return 0
  const cache = resolveCacheService(container)
  if (!cache) return 0
  const tenantIds = invalidation.tenantId ? [null, invalidation.tenantId] : [null]
  let deleted = 0
  for (const tenantId of tenantIds) {
    deleted += await createTenantScopedAccess({ cache, tenantId, baseTags: [] }).deleteByTags(tags)
  }
  return deleted
}

export function buyerContextCache(
  container: CacheContainer | null | undefined,
  scope: BuyerContextCacheScope,
): BuyerContextCache {
  const access = createTenantScopedAccess({
    cache: resolveCacheService(container),
    tenantId: scope.tenantId,
    baseTags: [ecommerceStoreTag(scope.storeId)],
  })
  return {
    get: (customerUserId) => access.get<BuyerContext>(buildBuyerContextCacheKey(scope.storeId, customerUserId)),
    set: (buyer) =>
      access.set(
        buildBuyerContextCacheKey(scope.storeId, buyer.customerUserId),
        buyer,
        BUYER_CONTEXT_TTL_MS,
        buyerContextTags(buyer, scope.tenantId),
      ),
    deleteByTags: (tags) => access.deleteByTags(tags),
  }
}
