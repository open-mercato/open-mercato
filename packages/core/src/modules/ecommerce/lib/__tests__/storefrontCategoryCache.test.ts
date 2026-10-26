const treeMock = jest.fn()
const landingMock = jest.fn()
const listMock = jest.fn()

jest.mock('../storefrontCategories', () => ({
  getStorefrontCategoryTree: (...args: unknown[]) => treeMock(...args),
  getStorefrontCategoryLanding: (...args: unknown[]) => landingMock(...args),
}))
jest.mock('../storefrontProducts', () => ({
  listStorefrontProducts: (...args: unknown[]) => listMock(...args),
}))

import type { AwilixContainer } from 'awilix'
import { createMemoryStrategy, type CacheStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import { catalogCategoryTag, catalogProductsTag } from '../cacheKeys'
import type { StorefrontCategoryLandingBlock, StorefrontCategoryTreeResponse } from '../storefrontCategories'
import {
  STOREFRONT_CATEGORY_LANDING_TTL_MS,
  STOREFRONT_CATEGORY_TREE_TTL_MS,
  cachedGetStorefrontCategoryLanding,
  cachedGetStorefrontCategoryTree,
  storefrontCategoryLandingCacheParts,
  storefrontCategoryLandingCacheTags,
  storefrontCategoryTreeCacheParts,
} from '../storefrontCategoryCache'
import type { StorefrontProductListResponse } from '../storefrontProducts'
import type { BuyerContext, StoreContext } from '../types'

const TENANT_ID = 'tenant-1'
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333'

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

function buildContext(digest: string, buyer: Partial<BuyerContext> = {}, effectiveLocale = 'en'): StoreContext {
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
    effectiveLocale,
    requestedLocale: null,
    currencyCode: 'EUR',
    digest,
  }
}

function treeResponse(marker: string): StorefrontCategoryTreeResponse {
  return { tree: [], effectiveLocale: marker }
}

function landingBlock(marker: string): StorefrontCategoryLandingBlock {
  return {
    category: {
      id: CATEGORY_ID,
      name: marker,
      slug: 'dresses',
      description: null,
      depth: 0,
      parentId: null,
      ancestorIds: [],
      breadcrumb: [{ id: CATEGORY_ID, name: marker, slug: 'dresses' }],
      children: [],
      productCount: 3,
      seo: { title: null, description: null, canonicalUrl: null },
    },
    effectiveLocale: 'en',
  }
}

function listResponse(marker: string, categoryId: string | null = CATEGORY_ID): StorefrontProductListResponse {
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
    appliedFilters: categoryId ? { category: { id: categoryId, slug: 'dresses', includesDescendants: true } } : {},
    availableSorts: ['featured'],
    appliedSort: 'featured',
    priceSort: { cap: 5000, fallback: 'approximate', capExceeded: false },
    sortApproximate: false,
    sortUnavailable: false,
  }
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

const landingQuery = { page: 1, pageSize: 24, availability: 'all' as const }

describe('storefront category cache', () => {
  beforeEach(() => {
    treeMock.mockReset()
    landingMock.mockReset()
    listMock.mockReset()
  })

  it('normalizes the tree query: resolution parameters and key order do not split entries', () => {
    const base = storefrontCategoryTreeCacheParts({ includeEmpty: false, depth: 2, parentId: CATEGORY_ID })
    expect(storefrontCategoryTreeCacheParts({ parentId: CATEGORY_ID, depth: 2, includeEmpty: false })).toEqual(base)
    expect(
      storefrontCategoryTreeCacheParts({ includeEmpty: false, depth: 2, parentId: CATEGORY_ID, locale: 'de', path: '/x' } as never),
    ).toEqual(base)
    expect(storefrontCategoryTreeCacheParts({ includeEmpty: true, depth: 2, parentId: CATEGORY_ID })).not.toEqual(base)
    expect(storefrontCategoryTreeCacheParts({ includeEmpty: false })).not.toEqual(base)
    expect(storefrontCategoryLandingCacheParts(' dresses ')).toEqual(['categories-landing', 'dresses'])
  })

  it('shares the tree between buyers with one assortment scope even when their digests differ', async () => {
    const { container, setSpy } = createContainer()
    treeMock.mockResolvedValue(treeResponse('shared'))
    const retail = buildContext('digest-retail', { priceScopeKey: 'price-retail', priceKindId: 'kind-1' })
    const wholesale = buildContext('digest-wholesale', { priceScopeKey: 'price-wholesale', customerOverlayId: 'person-1', isAuthenticated: true })
    const first = await cachedGetStorefrontCategoryTree(container, retail, { includeEmpty: false })
    const second = await cachedGetStorefrontCategoryTree(container, wholesale, { includeEmpty: false })
    expect(second).toEqual(first)
    expect(treeMock).toHaveBeenCalledTimes(1)
    const [key, , options] = setSpy.mock.calls[0]
    expect(key).toContain(':assortment:store-1:en:scope-a:categories-tree:')
    expect(options).toMatchObject({ ttl: STOREFRONT_CATEGORY_TREE_TTL_MS })
    expect([...(options?.tags ?? [])].sort()).toEqual(['ecommerce-store:store-1', `catalog-products:${TENANT_ID}`].sort())
  })

  it('separates buyers with different assortment scopes and different effective locales', async () => {
    const { container } = createContainer()
    treeMock
      .mockResolvedValueOnce(treeResponse('scope-a'))
      .mockResolvedValueOnce(treeResponse('scope-b'))
      .mockResolvedValueOnce(treeResponse('scope-a-de'))
    const a = await cachedGetStorefrontCategoryTree(container, buildContext('d', { assortmentScopeHash: 'scope-a' }), { includeEmpty: false })
    const b = await cachedGetStorefrontCategoryTree(container, buildContext('d', { assortmentScopeHash: 'scope-b' }), { includeEmpty: false })
    const de = await cachedGetStorefrontCategoryTree(container, buildContext('d', { assortmentScopeHash: 'scope-a' }, 'de'), { includeEmpty: false })
    expect(treeMock).toHaveBeenCalledTimes(3)
    expect([a.effectiveLocale, b.effectiveLocale, de.effectiveLocale]).toEqual(['scope-a', 'scope-b', 'scope-a-de'])
  })

  it('drops the tree when the tenant collection tag is evicted', async () => {
    const { cache, container } = createContainer()
    treeMock.mockResolvedValue(treeResponse('x'))
    const ctx = buildContext('digest-a')
    await cachedGetStorefrontCategoryTree(container, ctx, { includeEmpty: false })
    await cache.deleteByTags([catalogProductsTag(TENANT_ID)])
    await cachedGetStorefrontCategoryTree(container, ctx, { includeEmpty: false })
    expect(treeMock).toHaveBeenCalledTimes(2)
  })

  it('caches the landing category block per assortment and the embedded listing per digest', async () => {
    const { container, setSpy } = createContainer()
    landingMock.mockResolvedValue(landingBlock('Dresses'))
    listMock.mockImplementation(async (_container: unknown, ctx: StoreContext) => listResponse(ctx.digest))
    const retail = buildContext('digest-retail')
    const wholesale = buildContext('digest-wholesale', { priceScopeKey: 'price-b' })
    const first = await cachedGetStorefrontCategoryLanding(container, retail, 'dresses', landingQuery)
    const second = await cachedGetStorefrontCategoryLanding(container, wholesale, 'dresses', landingQuery)
    const repeat = await cachedGetStorefrontCategoryLanding(container, retail, 'dresses', landingQuery)
    expect(landingMock).toHaveBeenCalledTimes(1)
    expect(listMock).toHaveBeenCalledTimes(2)
    expect(first?.products.effectiveLocale).toBe('digest-retail')
    expect(second?.products.effectiveLocale).toBe('digest-wholesale')
    expect(repeat).toEqual(first)
    const landingSet = setSpy.mock.calls.find(([key]) => String(key).includes('categories-landing'))
    expect(landingSet?.[0]).toContain(':assortment:store-1:en:scope-a:categories-landing:dresses')
    expect(landingSet?.[2]).toMatchObject({ ttl: STOREFRONT_CATEGORY_LANDING_TTL_MS })
    const listSets = setSpy.mock.calls.filter(([key]) => String(key).includes('products-list'))
    expect(listSets).toHaveLength(2)
    expect(String(listSets[0][0])).toContain(':digest:store-1:digest-retail:')
    expect(String(listSets[1][0])).toContain(':digest:store-1:digest-wholesale:')
  })

  it('embeds a /products response filtered to the resolved category id, never to a client-supplied one', async () => {
    const { container } = createContainer()
    landingMock.mockResolvedValue(landingBlock('Dresses'))
    listMock.mockResolvedValue(listResponse('x'))
    await cachedGetStorefrontCategoryLanding(container, buildContext('digest-a'), 'dresses', {
      ...landingQuery,
      pageSize: 12,
      sort: 'newest',
    })
    expect(listMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ digest: 'digest-a' }),
      expect.objectContaining({ categoryId: CATEGORY_ID, pageSize: 12, sort: 'newest' }),
    )
    expect(listMock.mock.calls[0][2]).not.toHaveProperty('categorySlug')
  })

  it('shares the embedded listing entry with an identical GET /products?categoryId request', async () => {
    const { container } = createContainer()
    landingMock.mockResolvedValue(landingBlock('Dresses'))
    listMock.mockResolvedValue(listResponse('x'))
    const { cachedListStorefrontProducts } = await import('../storefrontProductCache')
    const ctx = buildContext('digest-a')
    await cachedGetStorefrontCategoryLanding(container, ctx, 'dresses', landingQuery)
    await cachedListStorefrontProducts(container, ctx, { ...landingQuery, categoryId: CATEGORY_ID })
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('never caches a missing category and never touches the listing for it', async () => {
    const { container, setSpy } = createContainer()
    landingMock.mockResolvedValue(null)
    const ctx = buildContext('digest-a')
    expect(await cachedGetStorefrontCategoryLanding(container, ctx, 'missing', landingQuery)).toBeNull()
    expect(await cachedGetStorefrontCategoryLanding(container, ctx, 'missing', landingQuery)).toBeNull()
    expect(landingMock).toHaveBeenCalledTimes(2)
    expect(listMock).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('answers null when the listing no longer resolves the category, instead of an unfiltered catalogue', async () => {
    const { container } = createContainer()
    landingMock.mockResolvedValue(landingBlock('Dresses'))
    listMock.mockResolvedValue(listResponse('x', null))
    expect(await cachedGetStorefrontCategoryLanding(container, buildContext('digest-a'), 'dresses', landingQuery)).toBeNull()
  })

  it('tags the landing block with the tenant collection and its own category, and drops it on a category event', async () => {
    const { cache, container } = createContainer()
    landingMock.mockResolvedValue(landingBlock('Dresses'))
    listMock.mockResolvedValue(listResponse('x'))
    const ctx = buildContext('digest-a')
    expect(storefrontCategoryLandingCacheTags(ctx, landingBlock('Dresses'))).toEqual([
      `catalog-products:${TENANT_ID}`,
      `catalog-category:${CATEGORY_ID}`,
    ])
    await cachedGetStorefrontCategoryLanding(container, ctx, 'dresses', landingQuery)
    await cache.deleteByTags([catalogCategoryTag(CATEGORY_ID)])
    await cachedGetStorefrontCategoryLanding(container, ctx, 'dresses', landingQuery)
    expect(landingMock).toHaveBeenCalledTimes(2)
  })
})
