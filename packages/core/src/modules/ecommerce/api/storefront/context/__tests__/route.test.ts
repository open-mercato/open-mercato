const resolveMock = jest.fn()
const findOneMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'storeContextService') return { resolve: resolveMock }
      if (name === 'em') return { findOne: findOneMock }
      throw new Error(`[internal] ${name} is not registered`)
    },
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
  ) => em.findOne(entity, where),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { ecommerceStoreSettingsSchema } from '../../../../data/validators'
import { StorefrontResolutionError, type StorefrontResolutionStatus, type StorefrontResolutionErrorCode } from '../../../../lib/storeContext'
import type { BuyerContext, StoreContext } from '../../../../lib/types'
import { GET, metadata, openApi, projectStorefrontContext } from '../route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_USER_ID = '44444444-4444-4444-8444-444444444444'
const PERSON_ID = '55555555-5555-4555-8555-555555555555'
const COMPANY_ID = '66666666-6666-4666-8666-666666666666'

const anonymousBuyer: BuyerContext = {
  customerUserId: null,
  customerId: null,
  companyId: null,
  customerIds: [],
  customerGroupIds: ['group-default'],
  isAuthenticated: false,
  taxMode: 'gross',
  priceKindId: 'price-kind-retail',
  allowPurchaseOnAccount: false,
  approvalRequiredAbove: null,
  assortmentScope: null,
  assortmentScopeHash: 'aaaaaaaaaaaaaaaa',
  priceScopeKey: 'bbbbbbbbbbbbbbbb',
  customerOverlayId: null,
}

const authenticatedBuyer: BuyerContext = {
  ...anonymousBuyer,
  customerUserId: CUSTOMER_USER_ID,
  customerId: PERSON_ID,
  companyId: COMPANY_ID,
  customerIds: [PERSON_ID, COMPANY_ID],
  customerGroupIds: ['group-wholesale'],
  isAuthenticated: true,
  taxMode: 'net',
  priceKindId: 'price-kind-wholesale',
  allowPurchaseOnAccount: true,
  approvalRequiredAbove: 1000,
  assortmentScope: [],
  customerOverlayId: PERSON_ID,
}

function makeContext(buyer: BuyerContext): StoreContext {
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
    organizationId: ORG_ID,
    channel: {
      channelBindingId: 'channel-binding-1',
      salesChannelId: 'sales-channel-1',
      priceKindId: 'price-kind-retail',
      priceSortFallback: 'approximate',
    },
    buyer,
    effectiveLocale: 'de',
    requestedLocale: 'de',
    currencyCode: 'EUR',
    digest: 'cccccccccccccccc',
  }
}

function request(query = ''): Request {
  return new Request(`https://shop.example.com/api/ecommerce/storefront/context${query}`, {
    headers: { host: 'shop.example.com' },
  })
}

describe('GET /api/ecommerce/storefront/context', () => {
  beforeEach(() => {
    resolveMock.mockReset()
    findOneMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares a public route with the declarative rate limit', () => {
    expect(metadata).toEqual({
      path: '/ecommerce/storefront/context',
      GET: {
        requireAuth: false,
        rateLimit: { points: 120, duration: 60, keyPrefix: 'ecommerce_storefront_context' },
      },
    })
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
  })

  it('projects only the public fields and never the internal buyer context', () => {
    const projection = projectStorefrontContext(makeContext(authenticatedBuyer), {
      displayName: 'Jane Buyer',
      companyName: 'Acme Ltd',
    })
    expect(Object.keys(projection).sort()).toEqual(
      ['buyer', 'currencyCode', 'effectiveLocale', 'requestedLocale', 'store', 'supportedLocales'].sort(),
    )
    expect(Object.keys(projection.store).sort()).toEqual(
      ['code', 'defaultCurrencyCode', 'defaultLocale', 'id', 'name', 'settings', 'slug', 'status', 'supportedLocales'].sort(),
    )
    expect(Object.keys(projection.buyer).sort()).toEqual(
      ['allowPurchaseOnAccount', 'companyName', 'displayName', 'isAuthenticated', 'taxMode'].sort(),
    )
    expect(projection.buyer).toEqual({
      isAuthenticated: true,
      taxMode: 'net',
      displayName: 'Jane Buyer',
      companyName: 'Acme Ltd',
      allowPurchaseOnAccount: true,
    })
    const serialized = JSON.stringify(projection)
    for (const leaked of ['group-wholesale', 'price-kind-wholesale', PERSON_ID, COMPANY_ID, CUSTOMER_USER_ID, 'cccccccccccccccc', 'bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', TENANT_ID, ORG_ID]) {
      expect(serialized).not.toContain(leaked)
    }
  })

  it('serves anonymous buyers with a public cache header and no names', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer))
    const response = await GET(request('?locale=de'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    const body = await response.json()
    expect(body.buyer).toEqual({
      isAuthenticated: false,
      taxMode: 'gross',
      displayName: null,
      companyName: null,
      allowPurchaseOnAccount: false,
    })
    expect(body.effectiveLocale).toBe('de')
    expect(body.supportedLocales).toEqual(['en', 'de'])
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it('serves authenticated buyers privately with display and company names read in scope', async () => {
    resolveMock.mockResolvedValue(makeContext(authenticatedBuyer))
    findOneMock.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUser) return { id: CUSTOMER_USER_ID, displayName: 'Jane Buyer' }
      if (entity === CustomerEntity) return { id: COMPANY_ID, displayName: 'Acme Ltd' }
      return null
    })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization, X-Locale, Accept-Language')
    const body = await response.json()
    expect(body.buyer.displayName).toBe('Jane Buyer')
    expect(body.buyer.companyName).toBe('Acme Ltd')
    expect(findOneMock).toHaveBeenCalledWith(
      CustomerUser,
      expect.objectContaining({ id: CUSTOMER_USER_ID, tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
    expect(findOneMock).toHaveBeenCalledWith(
      CustomerEntity,
      expect.objectContaining({ id: COMPANY_ID, tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
  })

  it('answers a null company name when the buyer has no company', async () => {
    resolveMock.mockResolvedValue(makeContext({ ...authenticatedBuyer, companyId: null, customerIds: [PERSON_ID] }))
    findOneMock.mockResolvedValue({ id: CUSTOMER_USER_ID, displayName: 'Jane Buyer' })
    const response = await GET(request())
    const body = await response.json()
    expect(body.buyer.companyName).toBeNull()
    expect(findOneMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown query parameters with 400 before resolving', async () => {
    const response = await GET(request('?foo=bar'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_query' })
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('forwards the path query as the resolution pathname and defaults to /', async () => {
    resolveMock.mockResolvedValue(makeContext(anonymousBuyer))
    await GET(request('?path=%2Fb2b%2Fproducts'))
    expect(resolveMock).toHaveBeenLastCalledWith(expect.any(Request), { pathname: '/b2b/products' })
    await GET(request())
    expect(resolveMock).toHaveBeenLastCalledWith(expect.any(Request), { pathname: '/' })
  })

  it('answers identical 404 bodies for unknown host, draft store and missing binding', async () => {
    const bodies: unknown[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      resolveMock.mockRejectedValueOnce(new StorefrontResolutionError(404, 'store_not_found'))
      const response = await GET(request())
      expect(response.status).toBe(404)
      bodies.push(await response.json())
    }
    expect(bodies).toEqual([{ error: 'store_not_found' }, { error: 'store_not_found' }, { error: 'store_not_found' }])
  })

  it.each<[StorefrontResolutionStatus, StorefrontResolutionErrorCode]>([
    [410, 'store_archived'],
    [503, 'store_misconfigured'],
    [401, 'portal_session_scope_mismatch'],
    [401, 'portal_session_invalid'],
    [400, 'store_slug_not_allowed'],
    [403, 'store_draft'],
  ])('maps a %s %s resolution error to a minimal body', async (status, code) => {
    resolveMock.mockRejectedValue(new StorefrontResolutionError(status, code))
    const response = await GET(request())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: code })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('reports unknown errors and answers 500 without details', async () => {
    const failure = new Error('database exploded')
    resolveMock.mockRejectedValue(failure)
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'ecommerce' }))
  })
})
