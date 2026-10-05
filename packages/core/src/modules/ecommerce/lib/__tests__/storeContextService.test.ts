import type { CacheStrategy } from '@open-mercato/cache'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import { resolveBuyerContext } from '../buyerContext'
import { resolveStoreBySlug, resolveStoreFromRequest, type ResolvedStore } from '../storeContext'
import { createStoreContextService } from '../storeContextService'
import type { BuyerContext } from '../types'

jest.mock('../storeContext', () => ({
  ...jest.requireActual('../storeContext'),
  resolveStoreFromRequest: jest.fn(),
  resolveStoreBySlug: jest.fn(),
}))

jest.mock('../buyerContext', () => ({
  ...jest.requireActual('../buyerContext'),
  resolveBuyerContext: jest.fn(),
}))

const mockedFromRequest = resolveStoreFromRequest as jest.Mock
const mockedBySlug = resolveStoreBySlug as jest.Mock
const mockedBuyer = resolveBuyerContext as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

const store: ResolvedStore = {
  source: 'slug',
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
  organizationId: '22222222-2222-4222-8222-222222222222',
  channel: {
    channelBindingId: 'channel-binding-1',
    salesChannelId: 'sales-channel-1',
    priceKindId: null,
    priceSortFallback: 'approximate',
    assortmentScope: null,
  },
  domain: null,
  effectiveLocale: 'en',
  requestedLocale: null,
  currencyCode: 'EUR',
}

const buyer: BuyerContext = {
  customerUserId: null,
  customerId: null,
  companyId: null,
  customerIds: [],
  customerGroupIds: ['group-default'],
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

function createContainer(services: Record<string, unknown>) {
  return {
    resolve: (name: string) => {
      if (!(name in services)) throw new Error(`[internal] unregistered ${name}`)
      return services[name]
    },
  }
}

describe('storeContextService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedFromRequest.mockResolvedValue(store)
    mockedBySlug.mockResolvedValue(store)
    mockedBuyer.mockResolvedValue(buyer)
  })

  it('composes the store and buyer layers for a request', async () => {
    const container = createContainer({})
    const service = createStoreContextService(container)
    const request = new Request('https://shop.example.com/products')

    const context = await service.resolve(request, { pathname: '/products' })

    expect(mockedFromRequest).toHaveBeenCalledWith(container, request, { pathname: '/products' })
    expect(mockedBuyer).toHaveBeenCalledWith(container, store, request)
    expect(context.buyer).toBe(buyer)
    expect(context.store.id).toBe('store-1')
    expect(context.digest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('resolves by slug as an anonymous buyer unless a request is supplied', async () => {
    const container = createContainer({})
    const service = createStoreContextService(container)

    await service.resolveBySlug('main', { locale: 'en' })

    expect(mockedBySlug).toHaveBeenCalledWith(container, 'main', { locale: 'en' })
    expect(mockedBuyer).toHaveBeenCalledWith(container, store, null)
  })

  it('invalidates the store tag in the resolution and tenant-scoped buyer caches', async () => {
    const deleteByTags = jest.fn(async () => 1)
    const cache = { get: jest.fn(), set: jest.fn(), deleteByTags } as unknown as CacheStrategy
    const service = createStoreContextService(createContainer({ cache }))

    await service.invalidate('store-1', { tenantId: TENANT_ID })

    expect(deleteByTags).toHaveBeenCalledTimes(2)
    expect(deleteByTags).toHaveBeenCalledWith(['ecommerce-store:store-1'])
  })
})
