import { getCurrentCacheTenant, type CacheStrategy } from '@open-mercato/cache'
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
    requireAuthentication: false,
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
    expect(mockedBuyer).toHaveBeenCalledWith(container, store, request, { fresh: undefined })
    expect(context.buyer).toBe(buyer)
    expect(context.store.id).toBe('store-1')
    expect(context.digest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('passes fresh: true through to resolveBuyerContext to bypass the 60s cache (D-R4-22)', async () => {
    const container = createContainer({})
    const service = createStoreContextService(container)
    const request = new Request('https://shop.example.com/products')

    await service.resolve(request, { pathname: '/products', fresh: true })

    expect(mockedBuyer).toHaveBeenCalledWith(container, store, request, { fresh: true })
  })

  it('defaults fresh to the cached path when resolve is called with no options at all', async () => {
    const container = createContainer({})
    const service = createStoreContextService(container)
    const request = new Request('https://shop.example.com/products')

    await service.resolve(request)

    expect(mockedBuyer).toHaveBeenCalledWith(container, store, request, { fresh: undefined })
  })

  it('resolves by slug as an anonymous buyer unless a request is supplied', async () => {
    const container = createContainer({})
    const service = createStoreContextService(container)

    await service.resolveBySlug('main', { locale: 'en' })

    expect(mockedBySlug).toHaveBeenCalledWith(container, 'main', { locale: 'en' })
    expect(mockedBuyer).toHaveBeenCalledWith(container, store, null)
  })

  it('resolves the buyer layer inside the store tenant cache namespace', async () => {
    const seenTenants: Array<string | null> = []
    mockedBuyer.mockImplementation(async () => {
      seenTenants.push(getCurrentCacheTenant())
      return buyer
    })
    const service = createStoreContextService(createContainer({}))

    await service.resolve(new Request('https://shop.example.com/'), { pathname: '/' })
    await service.resolveBySlug('main')

    expect(seenTenants).toEqual([TENANT_ID, TENANT_ID])
    expect(getCurrentCacheTenant()).toBeNull()
  })

  it('invalidates the store tag in the resolution and tenant-scoped buyer caches', async () => {
    const deleteByTags = jest.fn(async () => 1)
    const cache = { get: jest.fn(), set: jest.fn(), deleteByTags } as unknown as CacheStrategy
    const service = createStoreContextService(createContainer({ cache }))

    await service.invalidate('store-1', { tenantId: TENANT_ID })

    expect(deleteByTags).toHaveBeenCalledTimes(2)
    expect(deleteByTags).toHaveBeenCalledWith(['ecommerce-store:store-1'])
  })

  describe('findStoreForOrganizations', () => {
    const ORG_ID = '22222222-2222-4222-8222-222222222222'
    const STORE_ID = '33333333-3333-4333-8333-333333333333'

    function createKyselyEm(row: Record<string, string> | undefined) {
      const wheres: Array<[string, string, unknown]> = []
      const builder = {
        select: jest.fn(() => builder),
        where: jest.fn((column: string, operator: string, value: unknown) => {
          wheres.push([column, operator, value])
          return builder
        }),
        executeTakeFirst: jest.fn(async () => row),
      }
      const em = { getKysely: () => ({ selectFrom: jest.fn(() => builder) }) }
      return { em, wheres, builder }
    }

    it('returns the store ownership scoped to the tenant and organizations', async () => {
      const { em, wheres } = createKyselyEm({ id: STORE_ID, tenant_id: TENANT_ID, organization_id: ORG_ID })
      const service = createStoreContextService(createContainer({ em }))

      const result = await service.findStoreForOrganizations!({ tenantId: TENANT_ID, organizationIds: [ORG_ID], storeId: STORE_ID })

      expect(result).toEqual({ id: STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(wheres).toEqual([
        ['id', '=', STORE_ID],
        ['tenant_id', '=', TENANT_ID],
        ['deleted_at', 'is', null],
        ['organization_id', 'in', [ORG_ID]],
      ])
    })

    it('skips the organization filter when the caller is unrestricted within the tenant', async () => {
      const { em, wheres } = createKyselyEm({ id: STORE_ID, tenant_id: TENANT_ID, organization_id: ORG_ID })
      const service = createStoreContextService(createContainer({ em }))

      await service.findStoreForOrganizations!({ tenantId: TENANT_ID, organizationIds: null, storeId: STORE_ID })

      expect(wheres.map(([column]) => column)).not.toContain('organization_id')
    })

    it('returns null for an unknown or out-of-scope store', async () => {
      const { em } = createKyselyEm(undefined)
      const service = createStoreContextService(createContainer({ em }))

      await expect(
        service.findStoreForOrganizations!({ tenantId: TENANT_ID, organizationIds: [ORG_ID], storeId: STORE_ID }),
      ).resolves.toBeNull()
    })

    it('returns null without querying when the caller has no organizations', async () => {
      const { em, builder } = createKyselyEm({ id: STORE_ID, tenant_id: TENANT_ID, organization_id: ORG_ID })
      const service = createStoreContextService(createContainer({ em }))

      await expect(
        service.findStoreForOrganizations!({ tenantId: TENANT_ID, organizationIds: [], storeId: STORE_ID }),
      ).resolves.toBeNull()
      expect(builder.executeTakeFirst).not.toHaveBeenCalled()
    })
  })
})
