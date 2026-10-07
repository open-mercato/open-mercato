import { getCurrentCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import {
  buildEcommerceResolutionCacheKey,
  buildStorefrontCacheKey,
  buyerContextTags,
  ecommerceDomainMappingTag,
  ecommerceResolutionCache,
  ecommerceStoreTag,
  storefrontCache,
  type CacheContainer,
} from '../cacheKeys'
import type { BuyerContext, StoreContext } from '../types'

type RecordedCall = { operation: 'get' | 'set' | 'deleteByTags'; tenant: string | null; key?: string; tags?: string[]; ttl?: number }

function buildBuyer(overrides: Partial<BuyerContext> = {}): BuyerContext {
  return {
    customerUserId: null,
    customerId: null,
    companyId: null,
    customerIds: [],
    customerGroupIds: [],
    isAuthenticated: false,
    taxMode: 'gross',
    priceKindId: null,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    assortmentScope: null,
    assortmentScopeHash: 'scope-hash-a',
    priceScopeKey: 'price-scope-a',
    customerOverlayId: null,
    ...overrides,
  }
}

function buildContext(overrides: Partial<StoreContext> = {}, buyer: Partial<BuyerContext> = {}): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'de'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: null, priceSortFallback: 'approximate' },
    buyer: buildBuyer(buyer),
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest: 'digest-aaaaaaaaaa',
    ...overrides,
  }
}

function createRecordingCache() {
  const calls: RecordedCall[] = []
  const store = new Map<string, unknown>()
  const cache = {
    async get(key: string) {
      calls.push({ operation: 'get', tenant: getCurrentCacheTenant(), key })
      return store.has(key) ? store.get(key) : null
    },
    async set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) {
      calls.push({ operation: 'set', tenant: getCurrentCacheTenant(), key, tags: options?.tags, ttl: options?.ttl })
      store.set(key, value)
    },
    async deleteByTags(tags: string[]) {
      calls.push({ operation: 'deleteByTags', tenant: getCurrentCacheTenant(), tags })
      return 1
    },
  } as unknown as CacheStrategy
  const container: CacheContainer = {
    resolve: (name: string) => {
      if (name !== 'cache') throw new Error(`unexpected resolve ${name}`)
      return cache
    },
  }
  return { calls, container }
}

describe('buildStorefrontCacheKey', () => {
  it('namespaces keys and defaults to the digest scope', () => {
    const key = buildStorefrontCacheKey(buildContext(), ['products', 'page/1'])
    expect(key).toBe('ecommerce:storefront:digest:store-1:digest-aaaaaaaaaa:products:page%2F1')
  })

  it('separates digest-scoped keys for contexts with different digests', () => {
    const first = buildStorefrontCacheKey(buildContext(), ['products'])
    const second = buildStorefrontCacheKey(buildContext({ digest: 'digest-bbbbbbbbbb' }), ['products'])
    expect(first).not.toBe(second)
  })

  it('shares assortment-scoped keys between buyers with the same scope hash', () => {
    const groupBuyer = buildContext({ digest: 'digest-1' }, { customerIds: ['person-1'], assortmentScopeHash: 'shared' })
    const otherBuyer = buildContext({ digest: 'digest-2' }, { customerIds: ['person-2'], assortmentScopeHash: 'shared' })
    const restrictedBuyer = buildContext({ digest: 'digest-3' }, { customerIds: ['person-3'], assortmentScopeHash: 'narrow' })
    const groupKey = buildStorefrontCacheKey(groupBuyer, ['facets'], { scope: 'assortment' })
    expect(buildStorefrontCacheKey(otherBuyer, ['facets'], { scope: 'assortment' })).toBe(groupKey)
    expect(buildStorefrontCacheKey(restrictedBuyer, ['facets'], { scope: 'assortment' })).not.toBe(groupKey)
    expect(buildStorefrontCacheKey(buildContext({ effectiveLocale: 'de' }, { assortmentScopeHash: 'shared' }), ['facets'], { scope: 'assortment' })).not.toBe(groupKey)
  })

  it('keeps buyers with their own price rows off the shared price-scope bucket', () => {
    const shared = buildStorefrontCacheKey(buildContext(), ['prices'], { scope: 'priceScope' })
    const peer = buildStorefrontCacheKey(buildContext({ digest: 'other' }), ['prices'], { scope: 'priceScope' })
    const contracted = buildStorefrontCacheKey(
      buildContext({}, { customerOverlayId: 'person-1,company-1' }),
      ['prices'],
      { scope: 'priceScope' },
    )
    expect(peer).toBe(shared)
    expect(contracted).not.toBe(shared)
    expect(contracted).toContain('person-1%2Ccompany-1')
  })

  it('keys store-scoped entries by store and locale only', () => {
    const key = buildStorefrontCacheKey(buildContext({}, { customerIds: ['person-1'] }), ['branding'], { scope: 'store' })
    expect(key).toBe('ecommerce:storefront:store:store-1:en:branding')
    expect(buildStorefrontCacheKey(buildContext({ digest: 'x' }), ['branding'], { scope: 'store' })).toBe(key)
  })

  it('does not let URL-unsafe parts collide with segment boundaries', () => {
    const joined = buildStorefrontCacheKey(buildContext(), ['a:b'])
    const split = buildStorefrontCacheKey(buildContext(), ['a', 'b'])
    expect(joined).not.toBe(split)
  })

  it('rejects an empty parts list', () => {
    expect(() => buildStorefrontCacheKey(buildContext(), [])).toThrow('[internal]')
  })
})

describe('tag helpers', () => {
  it('builds §8 tags', () => {
    expect(ecommerceStoreTag('s1')).toBe('ecommerce-store:s1')
    expect(ecommerceDomainMappingTag('m1')).toBe('ecommerce-domain-mapping:m1')
    expect(buyerContextTags({ customerIds: ['p1', 'c1'], customerGroupIds: ['g1'] })).toEqual([
      'customer:p1',
      'customer:c1',
      'customer-group:g1',
    ])
    expect(buyerContextTags({ customerIds: [], customerGroupIds: [] }, 't1')).toEqual(['customer-group-none:t1'])
    expect(buyerContextTags({ customerIds: [], customerGroupIds: ['g1'] }, 't1')).toEqual(['customer-group:g1'])
  })
})

describe('storefrontCache', () => {
  it('runs every operation inside the context tenant and builds keys internally', async () => {
    const { calls, container } = createRecordingCache()
    const ctx = buildContext()
    const cache = storefrontCache(container, ctx)

    await cache.set(['products'], { items: [1] }, { ttlMs: 60_000, tags: ['extra'] })
    const value = await cache.get<{ items: number[] }>(['products'])
    const deleted = await cache.deleteByTags([ecommerceStoreTag(ctx.store.id)])

    expect(value).toEqual({ items: [1] })
    expect(deleted).toBe(1)
    expect(calls.map((call) => call.tenant)).toEqual(['tenant-1', 'tenant-1', 'tenant-1'])
    expect(calls[0].key).toBe(buildStorefrontCacheKey(ctx, ['products']))
    expect(calls[0].ttl).toBe(60_000)
    expect(calls[0].tags).toEqual(['ecommerce-store:store-1', 'extra'])
  })

  it('honours the scope on set and get', async () => {
    const { calls, container } = createRecordingCache()
    const ctx = buildContext()
    const cache = storefrontCache(container, ctx)
    await cache.set(['facets'], 1, { ttlMs: 1000, scope: 'assortment' })
    await cache.get(['facets'], { scope: 'assortment' })
    const expected = buildStorefrontCacheKey(ctx, ['facets'], { scope: 'assortment' })
    expect(calls.map((call) => call.key)).toEqual([expected, expected])
  })

  it('passes through when no cache is registered', async () => {
    const container: CacheContainer = {
      resolve: () => {
        throw new Error('not registered')
      },
    }
    const cache = storefrontCache(container, buildContext())
    await expect(cache.set(['products'], 1, { ttlMs: 1000 })).resolves.toBeUndefined()
    await expect(cache.get(['products'])).resolves.toBeNull()
    await expect(cache.deleteByTags(['x'])).resolves.toBe(0)
    const withoutContainer = storefrontCache(null, buildContext())
    await expect(withoutContainer.get(['products'])).resolves.toBeNull()
  })

  it('degrades to a miss when the cache backend fails', async () => {
    const failing = {
      get: async () => {
        throw new Error('down')
      },
      set: async () => {
        throw new Error('down')
      },
      deleteByTags: async () => {
        throw new Error('down')
      },
    }
    const cache = storefrontCache({ resolve: () => failing }, buildContext())
    await expect(cache.get(['products'])).resolves.toBeNull()
    await expect(cache.set(['products'], 1, { ttlMs: 1000 })).resolves.toBeUndefined()
    await expect(cache.deleteByTags(['x'])).resolves.toBe(0)
  })
})

describe('ecommerceResolutionCache', () => {
  it('runs outside any tenant with resolution-namespaced keys', async () => {
    const { calls, container } = createRecordingCache()
    const cache = ecommerceResolutionCache(container)
    await cache.set(['host', 'shop.example.com'], { storeId: 'store-1' }, { ttlMs: 300_000, tags: [ecommerceStoreTag('store-1')] })
    await expect(cache.get(['host', 'shop.example.com'])).resolves.toEqual({ storeId: 'store-1' })
    await cache.deleteByTags([ecommerceStoreTag('store-1')])
    expect(calls.map((call) => call.tenant)).toEqual([null, null, null])
    expect(calls[0].key).toBe(buildEcommerceResolutionCacheKey(['host', 'shop.example.com']))
    expect(calls[0].key).toBe('ecommerce:resolution:host:shop.example.com')
    expect(calls[0].tags).toEqual(['ecommerce-store:store-1'])
  })
})
