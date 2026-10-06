const resolveMock = jest.fn()
const landingMock = jest.fn()
const listMock = jest.fn()
const reportErrorMock = jest.fn()
const cacheHolder: { cache: unknown } = { cache: null }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'storeContextService') return { resolve: resolveMock }
      if (name === 'cache') return cacheHolder.cache
      throw new Error(`[internal] ${name} is not registered`)
    },
  }),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))
jest.mock('../../../../../lib/storefrontCategories', () => ({
  getStorefrontCategoryTree: jest.fn(),
  getStorefrontCategoryLanding: (...args: unknown[]) => landingMock(...args),
}))
jest.mock('../../../../../lib/storefrontProducts', () => ({
  listStorefrontProducts: (...args: unknown[]) => listMock(...args),
}))

import { createMemoryStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../../../../data/validators'
import { StorefrontResolutionError } from '../../../../../lib/storeContext'
import type { StorefrontCategoryLandingBlock } from '../../../../../lib/storefrontCategories'
import type { StorefrontProductListResponse } from '../../../../../lib/storefrontProducts'
import type { BuyerContext, StoreContext } from '../../../../../lib/types'
import { storefrontCategoryLandingResponseSchema } from '../../openapiSchemas'
import { GET, metadata, openApi } from '../route'

const CATEGORY_ID = '66666666-6666-4666-8666-666666666666'
const PARENT_ID = '88888888-8888-4888-8888-888888888888'

const anonymousBuyer: BuyerContext = {
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
  assortmentScopeHash: 'aaaaaaaaaaaaaaaa',
  priceScopeKey: 'bbbbbbbbbbbbbbbb',
  customerOverlayId: null,
}

function makeContext(buyer: BuyerContext, digest: string): StoreContext {
  return {
    store: {
      id: '33333333-3333-4333-8333-333333333333',
      code: 'main',
      name: 'Main store',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'de'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: null, priceSortFallback: 'approximate' },
    buyer,
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest,
  }
}

function block(): StorefrontCategoryLandingBlock {
  return {
    category: {
      id: CATEGORY_ID,
      name: 'Boots',
      slug: 'boots',
      description: null,
      depth: 1,
      parentId: PARENT_ID,
      ancestorIds: [PARENT_ID],
      breadcrumb: [
        { id: PARENT_ID, name: 'Shoes', slug: 'shoes' },
        { id: CATEGORY_ID, name: 'Boots', slug: 'boots' },
      ],
      children: [],
      productCount: 2,
      seo: { title: null, description: null, canonicalUrl: null },
    },
    effectiveLocale: 'en',
  }
}

function listResponse(overrides: Partial<StorefrontProductListResponse> = {}): StorefrontProductListResponse {
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
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    taxMode: 'gross',
    appliedFilters: { category: { id: CATEGORY_ID, slug: 'boots', includesDescendants: true } },
    availableSorts: ['featured', 'price_asc', 'price_desc', 'title_asc', 'title_desc', 'newest'],
    appliedSort: 'featured',
    priceSort: { cap: 5000, fallback: 'approximate', capExceeded: false },
    sortApproximate: false,
    sortUnavailable: false,
    ...overrides,
  }
}

function request(query = ''): Request {
  return new Request(`https://shop.example.com/api/ecommerce/storefront/categories/boots${query}`, {
    headers: { host: 'shop.example.com' },
  })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('GET /api/ecommerce/storefront/categories/:slug', () => {
  beforeEach(() => {
    resolveMock.mockReset()
    landingMock.mockReset()
    listMock.mockReset()
    reportErrorMock.mockReset()
    cacheHolder.cache = createMemoryStrategy()
  })

  it('declares a public dynamic route with the declarative rate limit and an OpenAPI doc', () => {
    expect(metadata).toEqual({
      path: '/ecommerce/storefront/categories/[slug]',
      GET: {
        requireAuth: false,
        rateLimit: { points: 240, duration: 60, keyPrefix: 'ecommerce_storefront_category_landing' },
      },
    })
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
  })

  it('embeds the category-filtered /products response and matches the documented schema', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    landingMock.mockResolvedValue(block())
    listMock.mockResolvedValue(listResponse({ total: 2, totalPages: 1 }))
    const response = await GET(request('?pageSize=12&sort=newest&options[color]=red'), params('boots'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=30')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    expect(body.category.id).toBe(CATEGORY_ID)
    expect(body.products.total).toBe(2)
    expect(body.effectiveLocale).toBe('en')
    expect(storefrontCategoryLandingResponseSchema.safeParse(body).success).toBe(true)
    expect(landingMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ digest: 'digest-anon' }), 'boots')
    expect(listMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ digest: 'digest-anon' }),
      expect.objectContaining({ categoryId: CATEGORY_ID, pageSize: 12, sort: 'newest', options: { color: ['red'] } }),
    )
  })

  it('serves authenticated buyers privately and forwards the sort flags of the embedded listing', async () => {
    resolveMock.mockResolvedValue(makeContext({ ...anonymousBuyer, isAuthenticated: true, customerUserId: 'user-1' }, 'digest-auth'))
    landingMock.mockResolvedValue(block())
    listMock.mockResolvedValue(listResponse({ sortApproximate: true, appliedSort: 'price_asc' }))
    const response = await GET(request('?sort=price_asc'), params('boots'))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-sort-approximate')).toBe('true')
    expect(response.headers.get('x-sort-unavailable')).toBeNull()
  })

  it('keys the embedded listing by digest and the category block by assortment scope', async () => {
    landingMock.mockResolvedValue(block())
    listMock.mockImplementation(async (_container: unknown, ctx: StoreContext) => listResponse({ effectiveLocale: ctx.digest }))
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-one'))
    const first = await (await GET(request(), params('boots'))).json()
    resolveMock.mockResolvedValueOnce(makeContext({ ...anonymousBuyer, priceScopeKey: 'other-price' }, 'digest-two'))
    const second = await (await GET(request(), params('boots'))).json()
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-one'))
    const third = await (await GET(request(), params('boots'))).json()
    expect(first.products.effectiveLocale).toBe('digest-one')
    expect(second.products.effectiveLocale).toBe('digest-two')
    expect(third.products.effectiveLocale).toBe('digest-one')
    expect(landingMock).toHaveBeenCalledTimes(1)
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('answers one identical 404 body for a missing, hidden or malformed slug', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    landingMock.mockResolvedValue(null)
    const missing = await GET(request(), params('no-such-slug'))
    const hidden = await GET(request(), params('boots'))
    const malformed = await GET(request(), params('x'.repeat(300)))
    const responses = [missing, hidden, malformed]
    const bodies = await Promise.all(responses.map((response) => response.json()))
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
    expect(responses.map((response) => response.headers.get('cache-control'))).toEqual(['no-store', 'no-store', 'no-store'])
    expect(bodies).toEqual([
      { error: 'category_not_found' },
      { error: 'category_not_found' },
      { error: 'category_not_found' },
    ])
    expect(landingMock).toHaveBeenCalledTimes(2)
    expect(listMock).not.toHaveBeenCalled()
  })

  it('rejects categoryId and categorySlug and every other grammar error with 400 before resolving the store', async () => {
    const categoryId = await GET(request(`?categoryId=${CATEGORY_ID}`), params('boots'))
    expect(categoryId.status).toBe(400)
    expect(await categoryId.json()).toEqual({ error: 'invalid_query', fields: { categoryId: 'unknown parameter' } })
    const categorySlug = await GET(request('?categorySlug=shoes'), params('boots'))
    expect(await categorySlug.json()).toEqual({ error: 'invalid_query', fields: { categorySlug: 'unknown parameter' } })
    const oversized = await GET(request('?pageSize=500'), params('boots'))
    expect(Object.keys((await oversized.json()).fields)).toEqual(['pageSize'])
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('maps store resolution errors before any category lookup and reports unknown failures', async () => {
    resolveMock.mockRejectedValueOnce(new StorefrontResolutionError(410, 'store_archived'))
    const archived = await GET(request(), params('boots'))
    expect(archived.status).toBe(410)
    expect(await archived.json()).toEqual({ error: 'store_archived' })
    expect(landingMock).not.toHaveBeenCalled()
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    const failure = new Error('database exploded')
    landingMock.mockRejectedValue(failure)
    const response = await GET(request(), params('boots'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'ecommerce' }))
  })
})
