const resolveMock = jest.fn()
const treeMock = jest.fn()
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
jest.mock('../../../../lib/storefrontCategories', () => ({
  getStorefrontCategoryTree: (...args: unknown[]) => treeMock(...args),
  getStorefrontCategoryLanding: jest.fn(),
}))

import { createMemoryStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../../../data/validators'
import { StorefrontResolutionError } from '../../../../lib/storeContext'
import type { StorefrontCategoryTreeResponse } from '../../../../lib/storefrontCategories'
import type { BuyerContext, StoreContext } from '../../../../lib/types'
import { storefrontCategoryTreeResponseSchema } from '../openapiSchemas'
import { GET, metadata, openApi } from '../route'

const CATEGORY_ID = '66666666-6666-4666-8666-666666666666'

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

function treeResponse(marker = 'en'): StorefrontCategoryTreeResponse {
  return {
    tree: [
      {
        id: CATEGORY_ID,
        name: 'Shoes',
        slug: 'shoes',
        description: null,
        depth: 0,
        parentId: null,
        productCount: 2,
        hasChildren: true,
        children: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            name: 'Boots',
            slug: 'boots',
            description: 'Warm',
            depth: 1,
            parentId: CATEGORY_ID,
            productCount: 1,
            hasChildren: false,
            children: [],
          },
        ],
      },
    ],
    effectiveLocale: marker,
  }
}

function request(query = ''): Request {
  return new Request(`https://shop.example.com/api/ecommerce/storefront/categories${query}`, {
    headers: { host: 'shop.example.com' },
  })
}

describe('GET /api/ecommerce/storefront/categories', () => {
  beforeEach(() => {
    resolveMock.mockReset()
    treeMock.mockReset()
    reportErrorMock.mockReset()
    cacheHolder.cache = createMemoryStrategy()
  })

  it('declares a public route with the declarative rate limit and an OpenAPI doc', () => {
    expect(metadata).toEqual({
      path: '/ecommerce/storefront/categories',
      GET: {
        requireAuth: false,
        rateLimit: { points: 120, duration: 60, keyPrefix: 'ecommerce_storefront_categories' },
      },
    })
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
    expect(openApi.methods.GET?.responses?.[0]?.status).toBe(200)
  })

  it('serves anonymous buyers publicly and matches the documented schema', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    treeMock.mockResolvedValue(treeResponse())
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=60')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    expect(storefrontCategoryTreeResponseSchema.safeParse(body).success).toBe(true)
    expect(treeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ digest: 'digest-anon' }),
      { includeEmpty: false },
    )
  })

  it('serves authenticated buyers privately while still using the server-side cache', async () => {
    resolveMock.mockResolvedValue(
      makeContext({ ...anonymousBuyer, isAuthenticated: true, customerUserId: 'user-1' }, 'digest-auth'),
    )
    treeMock.mockResolvedValue(treeResponse())
    const first = await GET(request())
    const second = await GET(request())
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    expect(second.headers.get('cache-control')).toBe('private, no-store')
    expect(treeMock).toHaveBeenCalledTimes(1)
  })

  it('shares one entry between digests with the same assortment scope and splits different scopes', async () => {
    treeMock.mockImplementation(async (_container: unknown, ctx: StoreContext) => treeResponse(ctx.buyer.assortmentScopeHash))
    resolveMock.mockResolvedValueOnce(makeContext(anonymousBuyer, 'digest-one'))
    const first = await (await GET(request())).json()
    resolveMock.mockResolvedValueOnce(makeContext({ ...anonymousBuyer, priceScopeKey: 'other-price' }, 'digest-two'))
    const shared = await (await GET(request())).json()
    resolveMock.mockResolvedValueOnce(makeContext({ ...anonymousBuyer, assortmentScopeHash: 'cccccccccccccccc' }, 'digest-one'))
    const separate = await (await GET(request())).json()
    expect(first.effectiveLocale).toBe('aaaaaaaaaaaaaaaa')
    expect(shared.effectiveLocale).toBe('aaaaaaaaaaaaaaaa')
    expect(separate.effectiveLocale).toBe('cccccccccccccccc')
    expect(treeMock).toHaveBeenCalledTimes(2)
  })

  it('passes parentId, depth and includeEmpty and forwards the path as the resolution pathname', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    treeMock.mockResolvedValue(treeResponse())
    await GET(request(`?parentId=${CATEGORY_ID}&depth=2&includeEmpty=true&path=%2Fb2b&locale=de`))
    expect(resolveMock).toHaveBeenLastCalledWith(expect.any(Request), { pathname: '/b2b' })
    expect(treeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ parentId: CATEGORY_ID, depth: 2, includeEmpty: true }),
    )
  })

  it('rejects grammar errors with 400 before resolving the store', async () => {
    const unknown = await GET(request('?categoryId=x'))
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('cache-control')).toBe('no-store')
    expect(await unknown.json()).toEqual({ error: 'invalid_query', fields: { categoryId: 'unknown parameter' } })
    const duplicate = await GET(request('?depth=1&depth=2'))
    expect(await duplicate.json()).toEqual({ error: 'invalid_query', fields: { depth: 'parameter given more than once' } })
    const malformed = await GET(request('?depth=0&parentId=nope&includeEmpty=maybe'))
    expect(Object.keys((await malformed.json()).fields).sort()).toEqual(['depth', 'includeEmpty', 'parentId'])
    expect(resolveMock).not.toHaveBeenCalled()
    expect(treeMock).not.toHaveBeenCalled()
  })

  it('maps store resolution errors to minimal bodies and reports unknown failures as a bare 500', async () => {
    resolveMock.mockRejectedValueOnce(new StorefrontResolutionError(404, 'store_not_found'))
    const missing = await GET(request())
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'store_not_found' })
    expect(reportErrorMock).not.toHaveBeenCalled()
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer, 'digest-anon'))
    const failure = new Error('database exploded')
    treeMock.mockRejectedValue(failure)
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'ecommerce' }))
  })
})
