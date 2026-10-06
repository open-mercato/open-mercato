const resolveMock = jest.fn()
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
jest.mock('../../../../lib/storefrontProducts', () => ({
  listStorefrontProducts: (...args: unknown[]) => listMock(...args),
}))

import { createMemoryStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../../../data/validators'
import { StorefrontResolutionError } from '../../../../lib/storeContext'
import type { StorefrontProductListResponse } from '../../../../lib/storefrontProducts'
import type { BuyerContext, StoreContext } from '../../../../lib/types'
import { GET, metadata, openApi } from '../route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const STORE_ID = '33333333-3333-4333-8333-333333333333'

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

const authenticatedBuyer: BuyerContext = {
  ...anonymousBuyer,
  customerUserId: '44444444-4444-4444-8444-444444444444',
  customerId: '55555555-5555-4555-8555-555555555555',
  customerIds: ['55555555-5555-4555-8555-555555555555'],
  isAuthenticated: true,
  taxMode: 'net',
}

function makeContext(buyer: BuyerContext, digest: string): StoreContext {
  return {
    store: {
      id: STORE_ID,
      code: 'main',
      name: 'Main store',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'de'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: TENANT_ID,
    organizationId: '22222222-2222-4222-8222-222222222222',
    channel: {
      channelBindingId: 'channel-binding-1',
      salesChannelId: 'sales-channel-1',
      priceKindId: null,
      priceSortFallback: 'approximate',
    },
    buyer,
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest,
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
    appliedFilters: {},
    availableSorts: ['featured', 'price_asc', 'price_desc', 'title_asc', 'title_desc', 'newest'],
    appliedSort: 'featured',
    priceSort: { cap: 5000, fallback: 'approximate', capExceeded: false },
    sortApproximate: false,
    sortUnavailable: false,
    ...overrides,
  }
}

function request(query = ''): Request {
  return new Request(`https://shop.example.com/api/ecommerce/storefront/products${query}`, {
    headers: { host: 'shop.example.com' },
  })
}

describe('GET /api/ecommerce/storefront/products', () => {
  beforeEach(() => {
    resolveMock.mockReset()
    listMock.mockReset()
    reportErrorMock.mockReset()
    cacheHolder.cache = createMemoryStrategy()
  })

  it('declares a public route with the declarative rate limit and an OpenAPI doc', () => {
    expect(metadata).toEqual({
      path: '/ecommerce/storefront/products',
      GET: {
        requireAuth: false,
        rateLimit: { points: 120, duration: 60, keyPrefix: 'ecommerce_storefront_products' },
      },
    })
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
    expect(openApi.methods.GET?.responses?.[0]?.status).toBe(200)
  })

  it('serves anonymous buyers with a public stale-while-revalidate header', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    listMock.mockResolvedValue(listResponse())
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=30')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    expect(response.headers.get('x-sort-approximate')).toBeNull()
    expect(response.headers.get('x-sort-unavailable')).toBeNull()
    expect((await response.json()).appliedSort).toBe('featured')
  })

  it('serves authenticated buyers privately while still using the server-side cache', async () => {
    resolveMock.mockResolvedValue(makeContext(authenticatedBuyer, 'digest-auth'))
    listMock.mockResolvedValue(listResponse({ taxMode: 'net' }))
    const first = await GET(request())
    const second = await GET(request())
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    expect(second.headers.get('cache-control')).toBe('private, no-store')
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('shares an entry between equal digests and separates different digests', async () => {
    listMock.mockImplementation(async (_container: unknown, ctx: StoreContext) =>
      listResponse({ effectiveLocale: ctx.digest }),
    )
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-one'))
    const first = await (await GET(request('?page=1'))).json()
    resolveMock.mockResolvedValueOnce(makeContext({ ...authenticatedBuyer }, 'digest-one'))
    const shared = await (await GET(request('?page=1'))).json()
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-two'))
    const separate = await (await GET(request('?page=1'))).json()
    expect(first.effectiveLocale).toBe('digest-one')
    expect(shared.effectiveLocale).toBe('digest-one')
    expect(separate.effectiveLocale).toBe('digest-two')
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('sets the sort headers from the listing flags', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    listMock.mockResolvedValueOnce(listResponse({ sortApproximate: true, appliedSort: 'price_asc' }))
    const approximate = await GET(request('?sort=price_asc'))
    expect(approximate.headers.get('x-sort-approximate')).toBe('true')
    expect(approximate.headers.get('x-sort-unavailable')).toBeNull()
    listMock.mockResolvedValueOnce(listResponse({ sortUnavailable: true }))
    const unavailable = await GET(request('?sort=price_desc'))
    expect(unavailable.headers.get('x-sort-unavailable')).toBe('true')
    expect(unavailable.headers.get('x-sort-approximate')).toBeNull()
  })

  it('passes the parsed query and forwards the path as the resolution pathname', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    listMock.mockResolvedValue(listResponse())
    await GET(request('?path=%2Fb2b&options[color]=red,blue&pageSize=12'))
    expect(resolveMock).toHaveBeenLastCalledWith(expect.any(Request), { pathname: '/b2b' })
    expect(listMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ digest: 'digest-anon' }),
      expect.objectContaining({ pageSize: 12, options: { color: ['red', 'blue'] } }),
    )
  })

  it('rejects grammar errors with 400 and the offending fields before resolving the store', async () => {
    const unknown = await GET(request('?colour=red'))
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('cache-control')).toBe('no-store')
    expect(await unknown.json()).toEqual({ error: 'invalid_query', fields: { colour: 'unknown parameter' } })
    const duplicate = await GET(request('?page=1&page=2'))
    expect(await duplicate.json()).toEqual({ error: 'invalid_query', fields: { page: 'parameter given more than once' } })
    const oversized = await GET(request('?pageSize=500'))
    expect(oversized.status).toBe(400)
    expect(Object.keys((await oversized.json()).fields)).toEqual(['pageSize'])
    expect(resolveMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('maps store resolution errors to identical minimal bodies', async () => {
    resolveMock.mockRejectedValue(new StorefrontResolutionError(404, 'store_not_found'))
    const first = await GET(request())
    const second = await GET(request('?storeSlug=other'))
    expect(first.status).toBe(404)
    expect(await first.json()).toEqual({ error: 'store_not_found' })
    expect(await second.json()).toEqual({ error: 'store_not_found' })
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('reports unknown failures and answers 500 without details', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    const failure = new Error('database exploded')
    listMock.mockRejectedValue(failure)
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'ecommerce' }))
  })
})
