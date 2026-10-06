const listMock = jest.fn()
const detailMock = jest.fn()

jest.mock('../storefrontProducts', () => ({
  listStorefrontProducts: (...args: unknown[]) => listMock(...args),
}))
jest.mock('../storefrontDetail', () => ({
  getStorefrontProductDetail: (...args: unknown[]) => detailMock(...args),
}))

import type { AwilixContainer } from 'awilix'
import { createMemoryStrategy, type CacheStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema, type EcommerceStorefrontProductListQuery } from '../../data/validators'
import { catalogProductsTag, catalogProductTag } from '../cacheKeys'
import {
  STOREFRONT_PRODUCT_DETAIL_TTL_MS,
  STOREFRONT_PRODUCT_LIST_TTL_MS,
  cachedGetStorefrontProductDetail,
  cachedListStorefrontProducts,
  storefrontProductDetailCacheParts,
  storefrontProductDetailCacheTags,
  storefrontProductListCacheParts,
  storefrontProductListCacheTags,
} from '../storefrontProductCache'
import type { StorefrontProductDetail } from '../storefrontDetail'
import type { StorefrontProductListResponse } from '../storefrontProducts'
import type { BuyerContext, StoreContext } from '../types'

const TENANT_ID = 'tenant-1'
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const RELATED_ID = '22222222-2222-4222-8222-222222222222'
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_CATEGORY_ID = '44444444-4444-4444-8444-444444444444'

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
    assortmentScopeHash: 'scope-a',
    priceScopeKey: 'price-a',
    customerOverlayId: null,
    ...overrides,
  }
}

function buildContext(digest: string, buyer: Partial<BuyerContext> = {}): StoreContext {
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
    tenantId: TENANT_ID,
    organizationId: 'org-1',
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: null, priceSortFallback: 'approximate' },
    buyer: buildBuyer(buyer),
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest,
  }
}

function listQuery(overrides: Partial<EcommerceStorefrontProductListQuery> = {}): EcommerceStorefrontProductListQuery {
  return { page: 1, pageSize: 24, availability: 'all', ...overrides }
}

function listResponse(marker: string, categoryId?: string): StorefrontProductListResponse {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 24,
    totalPages: 0,
    facets: {
      categories: [],
      tags: [],
      priceRange: null,
      options: [],
      productTypes: [],
      availability: [],
      availabilityScope: 'page',
      total: 0,
    },
    effectiveLocale: marker,
    requestedLocale: null,
    currencyCode: 'EUR',
    taxMode: 'gross',
    appliedFilters: categoryId ? { category: { id: categoryId, slug: null, includesDescendants: true } } : {},
    availableSorts: ['featured'],
    appliedSort: 'featured',
    priceSort: { cap: 5000, fallback: 'approximate', capExceeded: false },
    sortApproximate: false,
    sortUnavailable: false,
  }
}

function detail(): StorefrontProductDetail {
  return {
    id: PRODUCT_ID,
    categories: [{ id: CATEGORY_ID, name: 'Dresses', slug: 'dresses', ancestorIds: [PARENT_CATEGORY_ID] }],
    breadcrumb: [
      { id: PARENT_CATEGORY_ID, name: 'Women', slug: 'women' },
      { id: CATEGORY_ID, name: 'Dresses', slug: 'dresses' },
    ],
    relatedProducts: [{ id: RELATED_ID, categories: [{ id: CATEGORY_ID, name: 'Dresses', slug: 'dresses' }] }],
  } as unknown as StorefrontProductDetail
}

function createContainer() {
  const cache: CacheStrategy = createMemoryStrategy()
  const setSpy = jest.spyOn(cache, 'set')
  const container = {
    resolve: (name: string) => {
      if (name === 'cache') return cache
      throw new Error(`[internal] ${name} is not registered`)
    },
  } as unknown as AwilixContainer
  return { cache, container, setSpy }
}

describe('storefront product cache', () => {
  beforeEach(() => {
    listMock.mockReset()
    detailMock.mockReset()
  })

  it('normalizes the listing query: resolution parameters and key order do not split entries', () => {
    const base = storefrontProductListCacheParts(listQuery({ options: { color: ['red'], size: ['xl'] }, locale: 'de' }))
    const reordered = storefrontProductListCacheParts({
      locale: 'de',
      options: { size: ['xl'], color: ['red'] },
      availability: 'all',
      pageSize: 24,
      page: 1,
      path: '/b2b',
      storeSlug: 'main',
    })
    expect(reordered).toEqual(base)
    expect(storefrontProductListCacheParts(listQuery({ page: 2 }))).not.toEqual(storefrontProductListCacheParts(listQuery()))
    expect(storefrontProductListCacheParts(listQuery({ locale: 'en' }))).not.toEqual(storefrontProductListCacheParts(listQuery()))
  })

  it('keys detail entries by id or handle, selected variant and locale', () => {
    expect(storefrontProductDetailCacheParts(' dress ', {})).toEqual(['products-detail', 'dress', '-', '-'])
    expect(storefrontProductDetailCacheParts('dress', { variantId: 'variant-1', locale: 'de' })).toEqual([
      'products-detail',
      'dress',
      'variant-1',
      'de',
    ])
  })

  it('serves a second buyer with the same digest from the first buyer\'s entry', async () => {
    const { container, setSpy } = createContainer()
    listMock.mockResolvedValue(listResponse('first'))
    const first = await cachedListStorefrontProducts(container, buildContext('digest-shared', { customerIds: ['person-1'] }), listQuery())
    const second = await cachedListStorefrontProducts(container, buildContext('digest-shared', { customerIds: ['person-2'] }), listQuery())
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(setSpy).toHaveBeenCalledTimes(1)
    const [key, , options] = setSpy.mock.calls[0]
    expect(key).toContain(':digest:store-1:digest-shared:products-list:')
    expect(options).toMatchObject({ ttl: STOREFRONT_PRODUCT_LIST_TTL_MS })
  })

  it('keeps buyers with different digests on separate entries', async () => {
    const { container } = createContainer()
    listMock.mockResolvedValueOnce(listResponse('retail')).mockResolvedValueOnce(listResponse('wholesale'))
    const retail = await cachedListStorefrontProducts(container, buildContext('digest-retail'), listQuery())
    const wholesale = await cachedListStorefrontProducts(
      container,
      buildContext('digest-wholesale', { isAuthenticated: true, priceScopeKey: 'price-b' }),
      listQuery(),
    )
    expect(listMock).toHaveBeenCalledTimes(2)
    expect(retail.effectiveLocale).toBe('retail')
    expect(wholesale.effectiveLocale).toBe('wholesale')
  })

  it('tags listings with the store, the tenant collection, availability and the filtered category', async () => {
    const { container, setSpy } = createContainer()
    listMock.mockResolvedValue(listResponse('x', CATEGORY_ID))
    await cachedListStorefrontProducts(container, buildContext('digest-a'), listQuery({ categoryId: CATEGORY_ID }))
    const [, , options] = setSpy.mock.calls[0]
    expect([...(options?.tags ?? [])].sort()).toEqual(
      ['ecommerce-store:store-1', `catalog-products:${TENANT_ID}`, `availability:${TENANT_ID}`, `catalog-category:${CATEGORY_ID}`].sort(),
    )
    expect(storefrontProductListCacheTags(buildContext('digest-a'), listResponse('x'))).toEqual([
      `catalog-products:${TENANT_ID}`,
      `availability:${TENANT_ID}`,
    ])
  })

  it('drops a listing entry when its collection tag is evicted', async () => {
    const { cache, container } = createContainer()
    listMock.mockResolvedValue(listResponse('x'))
    const ctx = buildContext('digest-a')
    await cachedListStorefrontProducts(container, ctx, listQuery())
    await cache.deleteByTags([catalogProductsTag(TENANT_ID)])
    await cachedListStorefrontProducts(container, ctx, listQuery())
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('caches a found detail for 60 s with bounded per-product, price and category tags', async () => {
    const { container, setSpy } = createContainer()
    detailMock.mockResolvedValue(detail())
    const ctx = buildContext('digest-a')
    await cachedGetStorefrontProductDetail(container, ctx, 'dress', { variantId: null, locale: null })
    await cachedGetStorefrontProductDetail(container, ctx, 'dress', { variantId: null, locale: null })
    expect(detailMock).toHaveBeenCalledTimes(1)
    expect(detailMock).toHaveBeenCalledWith(container, ctx, 'dress', { variantId: null, locale: null })
    const [key, , options] = setSpy.mock.calls[0]
    expect(key).toBe('ecommerce:storefront:digest:store-1:digest-a:products-detail:dress:-:-')
    expect(options?.ttl).toBe(STOREFRONT_PRODUCT_DETAIL_TTL_MS)
    expect([...(options?.tags ?? [])].sort()).toEqual(
      [
        'ecommerce-store:store-1',
        ...storefrontProductDetailCacheTags(ctx, detail()),
      ].sort(),
    )
    expect(storefrontProductDetailCacheTags(ctx, detail()).sort()).toEqual(
      [
        `catalog-product:${PRODUCT_ID}`,
        `catalog-product:${RELATED_ID}`,
        `catalog-price:${PRODUCT_ID}`,
        `catalog-price:${RELATED_ID}`,
        `catalog-category:${CATEGORY_ID}`,
        `catalog-category:${PARENT_CATEGORY_ID}`,
        `availability:${TENANT_ID}`,
      ].sort(),
    )
  })

  it('re-reads a detail after its product tag is evicted', async () => {
    const { cache, container } = createContainer()
    detailMock.mockResolvedValue(detail())
    const ctx = buildContext('digest-a')
    await cachedGetStorefrontProductDetail(container, ctx, PRODUCT_ID)
    await cache.deleteByTags([catalogProductTag(PRODUCT_ID)])
    await cachedGetStorefrontProductDetail(container, ctx, PRODUCT_ID)
    expect(detailMock).toHaveBeenCalledTimes(2)
  })

  it('never caches a missing product', async () => {
    const { container, setSpy } = createContainer()
    detailMock.mockResolvedValue(null)
    const ctx = buildContext('digest-a')
    expect(await cachedGetStorefrontProductDetail(container, ctx, 'missing')).toBeNull()
    expect(await cachedGetStorefrontProductDetail(container, ctx, 'missing')).toBeNull()
    expect(detailMock).toHaveBeenCalledTimes(2)
    expect(setSpy).not.toHaveBeenCalled()
  })
})
