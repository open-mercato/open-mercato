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

export type CacheContainer = { resolve: (name: string) => unknown }

const STOREFRONT_KEY_NAMESPACE = 'ecommerce:storefront'
const RESOLUTION_KEY_NAMESPACE = 'ecommerce:resolution'
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

export function buildEcommerceResolutionCacheKey(parts: string[]): string {
  return `${RESOLUTION_KEY_NAMESPACE}:${encodeParts(parts)}`
}

export function ecommerceStoreTag(storeId: string): string {
  return `ecommerce-store:${storeId}`
}

export function ecommerceDomainMappingTag(domainMappingId: string): string {
  return `ecommerce-domain-mapping:${domainMappingId}`
}

export function ecommerceCustomerTag(customerId: string): string {
  return `customer:${customerId}`
}

export function ecommerceCustomerGroupTag(customerGroupId: string): string {
  return `customer-group:${customerGroupId}`
}

export function buyerContextTags(buyer: Pick<BuyerContext, 'customerIds' | 'customerGroupIds'>): string[] {
  return [
    ...buyer.customerIds.map(ecommerceCustomerTag),
    ...buyer.customerGroupIds.map(ecommerceCustomerGroupTag),
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
