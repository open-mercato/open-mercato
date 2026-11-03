const suggestMock = jest.fn()

jest.mock('../storefrontSearch', () => ({
  ...jest.requireActual('../storefrontSearch'),
  suggestStorefrontSearch: (...args: unknown[]) => suggestMock(...args),
}))

import type { AwilixContainer } from 'awilix'
import { createMemoryStrategy, type CacheStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import type { StorefrontSearchSuggestResponse } from '../storefrontSearch'
import {
  STOREFRONT_SEARCH_SUGGEST_TTL_MS,
  cachedSuggestStorefrontSearch,
  storefrontSearchSuggestCacheParts,
  storefrontSearchSuggestCacheTags,
} from '../storefrontSearchCache'
import type { StoreContext } from '../types'

const TENANT_ID = 'tenant-1'

function makeContext(digest = 'digest-1'): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: TENANT_ID,
    organizationId: 'org-1',
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: null, priceSortFallback: 'approximate' },
    buyer: {
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
      assortmentScopeHash: 'scope',
      priceScopeKey: 'price',
      customerOverlayId: null,
    },
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest,
  }
}

function containerWith(cache: CacheStrategy): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name === 'cache') return cache
      throw new Error(`[internal] ${name} is not registered`)
    },
  } as unknown as AwilixContainer
}

function response(title: string): StorefrontSearchSuggestResponse {
  return {
    products: [{ id: 'p-1', handle: 'p-1', title, defaultMediaUrl: null, formattedPrice: null }],
    categories: [],
    suggestions: [],
    effectiveLocale: 'en',
  }
}

describe('storefront search suggest cache', () => {
  beforeEach(() => {
    suggestMock.mockReset()
  })

  it('keys on the lowercased term and the limit', () => {
    expect(storefrontSearchSuggestCacheParts('Boot', 8)).toEqual(storefrontSearchSuggestCacheParts('boot', 8))
    expect(storefrontSearchSuggestCacheParts('boot', 8)[0]).toBe('search-suggest')
    expect(storefrontSearchSuggestCacheParts('boot', 8)).not.toEqual(storefrontSearchSuggestCacheParts('boot', 5))
    expect(storefrontSearchSuggestCacheParts('boot', 8)).not.toEqual(storefrontSearchSuggestCacheParts('boots', 8))
  })

  it('tags entries with the tenant product and availability tags', () => {
    expect(storefrontSearchSuggestCacheTags(makeContext())).toEqual([
      `catalog-products:${TENANT_ID}`,
      `availability:${TENANT_ID}`,
    ])
  })

  it('answers a term below the minimum length without touching the cache', async () => {
    const cache = createMemoryStrategy()
    const getSpy = jest.spyOn(cache, 'get')
    const setSpy = jest.spyOn(cache, 'set')
    suggestMock.mockResolvedValue(response('empty'))
    await cachedSuggestStorefrontSearch(containerWith(cache), makeContext(), { q: ' b ', limit: 8 })
    expect(getSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
    expect(suggestMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { q: ' b ', limit: 8 })
  })

  it('stores the normalized-term response with tags and TTL and serves case variants from it', async () => {
    const cache = createMemoryStrategy()
    const setSpy = jest.spyOn(cache, 'set')
    suggestMock.mockResolvedValue(response('Boot'))
    const container = containerWith(cache)
    const first = await cachedSuggestStorefrontSearch(container, makeContext(), { q: '  Boot  ', limit: 8 })
    const second = await cachedSuggestStorefrontSearch(container, makeContext(), { q: 'BOOT', limit: 8 })
    expect(first).toEqual(response('Boot'))
    expect(second).toEqual(first)
    expect(suggestMock).toHaveBeenCalledTimes(1)
    expect(suggestMock).toHaveBeenCalledWith(container, expect.anything(), { q: 'Boot', limit: 8 })
    expect(setSpy).toHaveBeenCalledTimes(1)
    const [key, , options] = setSpy.mock.calls[0]
    expect(String(key)).toContain(':digest:store-1:digest-1:search-suggest:')
    expect(options).toMatchObject({
      ttl: STOREFRONT_SEARCH_SUGGEST_TTL_MS,
      tags: expect.arrayContaining([`catalog-products:${TENANT_ID}`, `availability:${TENANT_ID}`, 'ecommerce-store:store-1']),
    })
  })

  it('does not share entries across buyer digests', async () => {
    const cache = createMemoryStrategy()
    suggestMock.mockImplementation(async (_container: unknown, ctx: StoreContext) => response(ctx.digest))
    const container = containerWith(cache)
    const one = await cachedSuggestStorefrontSearch(container, makeContext('digest-1'), { q: 'boot', limit: 8 })
    const two = await cachedSuggestStorefrontSearch(container, makeContext('digest-2'), { q: 'boot', limit: 8 })
    expect(one.products[0].title).toBe('digest-1')
    expect(two.products[0].title).toBe('digest-2')
    expect(suggestMock).toHaveBeenCalledTimes(2)
  })
})
