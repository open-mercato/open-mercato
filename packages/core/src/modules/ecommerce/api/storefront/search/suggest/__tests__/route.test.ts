const limiterHolder: { limiter: unknown } = { limiter: null }
const resolveMock = jest.fn()
const suggestMock = jest.fn()
const reportErrorMock = jest.fn()
const cacheHolder: { cache: unknown } = { cache: null }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'storeContextService') return { resolve: resolveMock }
      if (name === 'cache') return cacheHolder.cache
      if (name === 'rateLimiterService') return limiterHolder.limiter
      throw new Error(`[internal] ${name} is not registered`)
    },
  }),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))
jest.mock('../../../../../lib/storefrontSearch', () => ({
  ...jest.requireActual('../../../../../lib/storefrontSearch'),
  suggestStorefrontSearch: (...args: unknown[]) => suggestMock(...args),
}))

import { createMemoryStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../../../../data/validators'
import { StorefrontResolutionError } from '../../../../../lib/storeContext'
import type { StorefrontSearchSuggestResponse } from '../../../../../lib/storefrontSearch'
import type { BuyerContext, StoreContext } from '../../../../../lib/types'
import { storefrontSearchSuggestResponseSchema } from '../openapiSchemas'
import {
  CLIENT_IP,
  createAllowingLimiter,
  createExhaustedLimiter,
  declaredStatuses,
  expectMatchesOpenApi,
  withClientIp,
} from '../../../__tests__/openApiContract'
import { GET, metadata, openApi } from '../route'

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

function suggestResponse(price = '€10.00'): StorefrontSearchSuggestResponse {
  return {
    products: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        handle: 'linen-dress',
        title: 'Linen dress',
        defaultMediaUrl: null,
        formattedPrice: price,
      },
    ],
    categories: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Dresses', slug: 'dresses' }],
    suggestions: [],
    effectiveLocale: 'en',
  }
}

function request(query = ''): Request {
  return new Request(`https://shop.example.com/api/ecommerce/storefront/search/suggest${query}`, {
    headers: { host: 'shop.example.com' },
  })
}

describe('GET /api/ecommerce/storefront/search/suggest', () => {
  beforeEach(() => {
    resolveMock.mockReset()
    suggestMock.mockReset()
    reportErrorMock.mockReset()
    limiterHolder.limiter = null
    cacheHolder.cache = createMemoryStrategy()
  })

  it('declares a public route with an OpenAPI doc', () => {
    expect(metadata).toEqual({ path: '/ecommerce/storefront/search/suggest', GET: { requireAuth: false } })
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
    expect(openApi.methods.GET?.responses?.[0]?.status).toBe(200)
  })

  it('serves anonymous buyers publicly, passes q and the default limit, and matches the documented schema', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    suggestMock.mockResolvedValue(suggestResponse())
    const response = await GET(request('?q=dress'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=30')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    expect(storefrontSearchSuggestResponseSchema.safeParse(body).success).toBe(true)
    expect(suggestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ digest: 'digest-anon' }),
      { q: 'dress', limit: 8 },
    )
  })

  it('keys the server-side cache on the digest, the normalized term and limit', async () => {
    suggestMock.mockImplementation(async (_container: unknown, ctx: StoreContext) => suggestResponse(ctx.digest))
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-one'))
    const first = await (await GET(request('?q=Dress'))).json()
    const sameTerm = await (await GET(request('?q=%20dress%20'))).json()
    await GET(request('?q=dress&limit=3'))
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-two'))
    const otherBuyer = await (await GET(request('?q=dress'))).json()
    expect(first.products[0].formattedPrice).toBe('digest-one')
    expect(sameTerm.products[0].formattedPrice).toBe('digest-one')
    expect(otherBuyer.products[0].formattedPrice).toBe('digest-two')
    expect(suggestMock).toHaveBeenCalledTimes(3)
  })

  it('serves authenticated buyers privately while still using the server-side cache', async () => {
    resolveMock.mockResolvedValue(
      makeContext({ ...anonymousBuyer, isAuthenticated: true, customerUserId: 'user-1' }, 'digest-auth'),
    )
    suggestMock.mockResolvedValue(suggestResponse())
    const first = await GET(request('?q=dress'))
    const second = await GET(request('?q=dress'))
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    expect(second.headers.get('cache-control')).toBe('private, no-store')
    expect(suggestMock).toHaveBeenCalledTimes(1)
  })

  it('answers a q shorter than two characters with 200 and empty arrays, uncached', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    suggestMock.mockImplementation(jest.requireActual('../../../../../lib/storefrontSearch').suggestStorefrontSearch)
    const response = await GET(request('?q=a'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ products: [], categories: [], suggestions: [], effectiveLocale: 'en' })
  })

  it('rejects a missing q and grammar errors with 400 before resolving the store', async () => {
    const missing = await GET(request())
    expect(missing.status).toBe(400)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(Object.keys((await missing.json()).fields)).toEqual(['q'])
    const unknown = await GET(request('?q=dress&search=dress'))
    expect(await unknown.json()).toEqual({ error: 'invalid_query', fields: { search: 'unknown parameter' } })
    const duplicate = await GET(request('?q=a&q=b'))
    expect(await duplicate.json()).toEqual({ error: 'invalid_query', fields: { q: 'parameter given more than once' } })
    const malformed = await GET(request('?q=dress&limit=21'))
    expect(Object.keys((await malformed.json()).fields)).toEqual(['limit'])
    expect(resolveMock).not.toHaveBeenCalled()
    expect(suggestMock).not.toHaveBeenCalled()
  })

  it('maps store resolution errors to minimal bodies and reports unknown failures as a bare 500', async () => {
    resolveMock.mockRejectedValueOnce(new StorefrontResolutionError(404, 'store_not_found'))
    const missing = await GET(request('?q=dress'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'store_not_found' })
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    const failure = new Error('database exploded')
    suggestMock.mockRejectedValue(failure)
    const response = await GET(request('?q=dress'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'ecommerce.storefront_search_suggest_failed' }))
  })

  describe('rate limiting', () => {
    it('answers 429 with Retry-After once the limit is spent, before any catalogue work', async () => {
      resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
      suggestMock.mockResolvedValue(suggestResponse())
      limiterHolder.limiter = createExhaustedLimiter()
      const response = await GET(withClientIp(request('?q=dress')))
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('30')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(suggestMock).not.toHaveBeenCalled()
    })

    it('counts per client ip and store with the endpoint limit', async () => {
      resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
      suggestMock.mockResolvedValue(suggestResponse())
      const limiter = createAllowingLimiter()
      limiterHolder.limiter = limiter
      const response = await GET(withClientIp(request('?q=dress')))
      expect(response.status).toBe(200)
      expect(limiter.consume).toHaveBeenCalledTimes(1)
      expect(limiter.consume).toHaveBeenCalledWith(
        `${CLIENT_IP}:33333333-3333-4333-8333-333333333333`,
        expect.objectContaining({ points: 300, duration: 60, keyPrefix: 'ecommerce_storefront_search_suggest' }),
      )
    })

    it('serves the request and reports when the limiter throws', async () => {
      resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
      suggestMock.mockResolvedValue(suggestResponse())
      limiterHolder.limiter = { trustProxyDepth: 1, consume: jest.fn(async () => { throw new Error('limiter backend down') }) }
      const response = await GET(withClientIp(request('?q=dress')))
      expect(response.status).toBe(200)
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ code: 'ecommerce.storefront_rate_limit_failed' }),
      )
    })

    it('serves the request without counting when no trusted client ip is available', async () => {
      resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
      suggestMock.mockResolvedValue(suggestResponse())
      const limiter = createExhaustedLimiter()
      limiterHolder.limiter = { ...limiter, trustProxyDepth: 0 }
      const response = await GET(withClientIp(request('?q=dress')))
      expect(response.status).toBe(200)
      expect(limiter.consume).not.toHaveBeenCalled()
    })
  })

  describe('OpenAPI contract', () => {
    it('documents every status the handler answers and each body matches its declared schema', async () => {
      const observed: number[] = []
      const check = async (response: Response) => {
        observed.push(response.status)
        await expectMatchesOpenApi(openApi, response)
      }
      resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
      suggestMock.mockResolvedValue(suggestResponse())
      await check(await GET(withClientIp(request('?q=dress'))))
      await check(await GET(withClientIp(request())))
      for (const [status, code] of [
        [401, 'portal_session_invalid'],
        [403, 'store_draft'],
        [404, 'store_not_found'],
        [410, 'store_archived'],
        [503, 'store_misconfigured'],
      ] as const) {
        resolveMock.mockRejectedValueOnce(new StorefrontResolutionError(status, code))
        await check(await GET(withClientIp(request('?q=dress'))))
      }
      limiterHolder.limiter = createExhaustedLimiter()
      await check(await GET(withClientIp(request('?q=dress'))))
      expect([...new Set(observed)].sort((left, right) => left - right)).toEqual(
        [...declaredStatuses(openApi)].sort((left, right) => left - right),
      )
    })
  })
})
