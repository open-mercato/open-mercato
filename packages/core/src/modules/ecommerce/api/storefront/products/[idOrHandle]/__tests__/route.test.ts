const resolveMock = jest.fn()
const detailMock = jest.fn()
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
jest.mock('../../../../../lib/storefrontDetail', () => ({
  getStorefrontProductDetail: (...args: unknown[]) => detailMock(...args),
}))

import { createMemoryStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../../../../data/validators'
import { StorefrontResolutionError } from '../../../../../lib/storeContext'
import type { StorefrontProductDetail } from '../../../../../lib/storefrontDetail'
import type { BuyerContext, StoreContext } from '../../../../../lib/types'
import { GET, metadata, openApi } from '../route'

const PRODUCT_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'

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

function detail(title = 'Dress'): StorefrontProductDetail {
  return {
    id: PRODUCT_ID,
    title,
    categories: [],
    breadcrumb: [],
    relatedProducts: [],
    variants: [],
    selectedVariantId: null,
    priceTiers: [],
  } as unknown as StorefrontProductDetail
}

function request(query = ''): Request {
  return new Request(`https://shop.example.com/api/ecommerce/storefront/products/dress${query}`, {
    headers: { host: 'shop.example.com' },
  })
}

function params(idOrHandle: string) {
  return { params: Promise.resolve({ idOrHandle }) }
}

describe('GET /api/ecommerce/storefront/products/:idOrHandle', () => {
  beforeEach(() => {
    resolveMock.mockReset()
    detailMock.mockReset()
    reportErrorMock.mockReset()
    cacheHolder.cache = createMemoryStrategy()
  })

  it('declares a public dynamic route with the declarative rate limit and an OpenAPI doc', () => {
    expect(metadata).toEqual({
      path: '/ecommerce/storefront/products/[idOrHandle]',
      GET: {
        requireAuth: false,
        rateLimit: { points: 240, duration: 60, keyPrefix: 'ecommerce_storefront_product_detail' },
      },
    })
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
  })

  it('serves anonymous buyers publicly and passes variantId and locale through', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    detailMock.mockResolvedValue(detail())
    const response = await GET(request(`?variantId=${VARIANT_ID}&locale=de`), params('dress'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    expect((await response.json()).id).toBe(PRODUCT_ID)
    expect(detailMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ digest: 'digest-anon' }),
      'dress',
      { variantId: VARIANT_ID, locale: 'de' },
    )
  })

  it('serves authenticated buyers privately while still using the server-side cache', async () => {
    resolveMock.mockResolvedValue(makeContext(authenticatedBuyer, 'digest-auth'))
    detailMock.mockResolvedValue(detail())
    const first = await GET(request(), params('dress'))
    const second = await GET(request(), params('dress'))
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    expect(second.headers.get('cache-control')).toBe('private, no-store')
    expect(detailMock).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by digest: equal digests share, different digests do not', async () => {
    detailMock.mockImplementation(async (_container: unknown, ctx: StoreContext) => detail(ctx.digest))
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-one'))
    const first = await (await GET(request(), params('dress'))).json()
    resolveMock.mockResolvedValueOnce(makeContext(authenticatedBuyer, 'digest-one'))
    const shared = await (await GET(request(), params('dress'))).json()
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-two'))
    const separate = await (await GET(request(), params('dress'))).json()
    expect(first.title).toBe('digest-one')
    expect(shared.title).toBe('digest-one')
    expect(separate.title).toBe('digest-two')
    expect(detailMock).toHaveBeenCalledTimes(2)
  })

  it('answers one identical 404 body for a missing, restricted or malformed product', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    detailMock.mockResolvedValue(null)
    const missing = await GET(request(), params('no-such-handle'))
    const restricted = await GET(request(), params(PRODUCT_ID))
    const malformed = await GET(request(), params('x'.repeat(300)))
    const responses = [missing, restricted, malformed]
    const bodies = await Promise.all(responses.map((response) => response.json()))
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
    expect(responses.map((response) => response.headers.get('cache-control'))).toEqual(['no-store', 'no-store', 'no-store'])
    expect(bodies).toEqual([
      { error: 'product_not_found' },
      { error: 'product_not_found' },
      { error: 'product_not_found' },
    ])
    expect(detailMock).toHaveBeenCalledTimes(2)
  })

  it('rejects grammar errors with 400 before resolving the store', async () => {
    const response = await GET(request('?variantId=nope'), params('dress'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_query', fields: { variantId: expect.any(String) } })
    const unknown = await GET(request('?sort=title_asc'), params('dress'))
    expect(await unknown.json()).toEqual({ error: 'invalid_query', fields: { sort: 'unknown parameter' } })
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('maps store resolution errors before any product lookup', async () => {
    resolveMock.mockRejectedValue(new StorefrontResolutionError(410, 'store_archived'))
    const response = await GET(request(), params('dress'))
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: 'store_archived' })
    expect(detailMock).not.toHaveBeenCalled()
  })

  it('reports unknown failures and answers 500 without details', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    const failure = new Error('database exploded')
    detailMock.mockRejectedValue(failure)
    const response = await GET(request(), params('dress'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'ecommerce' }))
  })
})
