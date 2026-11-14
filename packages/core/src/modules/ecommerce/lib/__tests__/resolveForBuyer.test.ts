import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import type { CacheStrategy } from '@open-mercato/cache'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { createStoreContextService } from '../storeContextService'
import { StorefrontResolutionError, loadStoreChannelForBuyer, type StoreChannelForBuyer } from '../storeContext'

jest.mock('../storeContext', () => ({
  ...jest.requireActual('../storeContext'),
  loadStoreChannelForBuyer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
  ) => em.findOne(entity, where),
}))

const mockedLoadStoreChannelForBuyer = loadStoreChannelForBuyer as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '44444444-4444-4444-8444-444444444444'
const STORE_ID = 'store-1'

type UserRow = {
  id: string
  tenantId: string
  organizationId: string
  personEntityId: string | null
  customerEntityId: string | null
}

type GroupFixture = {
  groupIds: string[]
  priceKindId?: string | null
  scope?: EffectiveAssortmentScope
}

type HarnessOptions = {
  users?: UserRow[]
  priceKinds?: Record<string, string>
  groupsByCustomer?: Record<string, GroupFixture>
}

function createHarness(options: HarnessOptions = {}) {
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<Record<string, never>>) => new PostgresIntrospector(instance),
    },
  })
  const executor = db.getExecutor() as unknown as { executeQuery: (query: CompiledQuery) => Promise<{ rows: unknown[] }> }
  executor.executeQuery = async () => ({ rows: [] })

  const users = options.users ?? []
  const priceKinds = options.priceKinds ?? {}
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === CustomerUser) {
      return (
        users.find(
          (u) => u.id === where.id && u.tenantId === where.tenantId && u.organizationId === where.organizationId,
        ) ?? null
      )
    }
    if (entity === CatalogPriceKind) {
      const displayMode = priceKinds[String(where.id)]
      return displayMode ? { id: where.id, displayMode } : null
    }
    return null
  })
  const em = { findOne, getKysely: () => db }

  const fixtureFor = (customerIds: string[] | undefined): GroupFixture => {
    const ids = customerIds ?? []
    const fixtures = ids.map((id) => options.groupsByCustomer?.[id]).filter((entry): entry is GroupFixture => !!entry)
    if (fixtures.length === 0) return { groupIds: [], scope: null }
    return {
      groupIds: Array.from(new Set(fixtures.flatMap((entry) => entry.groupIds))),
      priceKindId: fixtures.find((entry) => entry.priceKindId !== undefined)?.priceKindId ?? null,
      scope: fixtures[0].scope ?? null,
    }
  }

  const customerGroupsService = {
    resolveGroups: jest.fn(async (input: { customerIds?: string[] }) => ({
      groupIds: fixtureFor(input.customerIds).groupIds,
      groups: [],
    })),
    resolveTerms: jest.fn(async (input: { customerIds?: string[] }) => {
      const fixture = fixtureFor(input.customerIds)
      return {
        priceKindId: fixture.priceKindId ?? null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: false,
        approvalRequiredAbove: null,
        minOrderValue: null,
        sources: {},
      }
    }),
    resolveAssortmentScope: jest.fn(async (input: { customerIds?: string[] }) => ({
      scope: fixtureFor(input.customerIds).scope ?? null,
      sourceGroupIds: [],
      sourceCustomerOverrideId: null,
    })),
  }

  const cache: CacheStrategy = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    deleteByTags: jest.fn(async () => 0),
  } as unknown as CacheStrategy

  const services: Record<string, unknown> = { em, cache, customerGroupsService }
  const container = {
    resolve: (name: string) => {
      if (!(name in services)) throw new Error(`[internal] unregistered ${name}`)
      return services[name]
    },
  }
  return { container, cache, customerGroupsService }
}

function user(id: string, personEntityId: string | null, customerEntityId: string | null, overrides: Partial<UserRow> = {}): UserRow {
  return { id, tenantId: TENANT_ID, organizationId: ORG_ID, personEntityId, customerEntityId, ...overrides }
}

describe('storeContextService.resolveForBuyer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('(a) resolves a known buyer\'s groups/price kind/currency without a store', async () => {
    const harness = createHarness({
      users: [user('user-1', 'person-1', 'company-1')],
      priceKinds: { 'kind-a': 'excluding-tax' },
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'], priceKindId: 'kind-a' } },
    })
    const service = createStoreContextService(harness.container)

    const result = await service.resolveForBuyer({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerUserId: 'user-1',
    })

    expect(mockedLoadStoreChannelForBuyer).not.toHaveBeenCalled()
    expect(result.storeId).toBeNull()
    expect(result.customerUserId).toBe('user-1')
    expect(result.customerIds).toEqual(['person-1', 'company-1'])
    expect(result.customerGroupIds).toEqual(['group-1'])
    expect(result.priceKindId).toBe('kind-a')
    expect(result.taxMode).toBe('net')
    expect(result.currencyCode).toBeNull()
    expect('assortmentScope' in result).toBe(false)
    expect(result.buyerDigest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('(b) resolves with a store and gets assortmentScope', async () => {
    const harness = createHarness({
      users: [user('user-1', 'person-1', 'company-1')],
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'], scope: null } },
    })
    mockedLoadStoreChannelForBuyer.mockResolvedValue({
      currencyCode: 'EUR',
      priceDisplayModeDefault: 'gross',
      channel: { priceKindId: null, assortmentScope: null, requireAuthentication: false },
    } satisfies StoreChannelForBuyer)
    const service = createStoreContextService(harness.container)

    const result = await service.resolveForBuyer({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      customerUserId: 'user-1',
    })

    expect(mockedLoadStoreChannelForBuyer).toHaveBeenCalledWith(harness.container, {
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(result.storeId).toBe(STORE_ID)
    expect(result.currencyCode).toBe('EUR')
    expect('assortmentScope' in result).toBe(true)
    expect(result.assortmentScope).toBeNull()
  })

  it('(c) refuses a store outside the tenant', async () => {
    const harness = createHarness({})
    mockedLoadStoreChannelForBuyer.mockImplementation(async (_container: unknown, input: { tenantId: string; organizationId: string }) =>
      input.tenantId === TENANT_ID && input.organizationId === ORG_ID
        ? { currencyCode: 'EUR', priceDisplayModeDefault: 'gross', channel: null }
        : null,
    )
    const service = createStoreContextService(harness.container)

    const promise = service.resolveForBuyer({
      tenantId: OTHER_TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
    })

    await expect(promise).rejects.toBeInstanceOf(StorefrontResolutionError)
    await promise.catch((error: StorefrontResolutionError) => {
      expect(error.status).toBe(403)
      expect(error.code).toBe('store_out_of_scope')
    })
  })

  it('(d) refuses a store outside the organization (same tenant, different org)', async () => {
    const harness = createHarness({})
    mockedLoadStoreChannelForBuyer.mockImplementation(async (_container: unknown, input: { tenantId: string; organizationId: string }) =>
      input.tenantId === TENANT_ID && input.organizationId === ORG_ID
        ? { currencyCode: 'EUR', priceDisplayModeDefault: 'gross', channel: null }
        : null,
    )
    const service = createStoreContextService(harness.container)

    const promise = service.resolveForBuyer({
      tenantId: TENANT_ID,
      organizationId: OTHER_ORG_ID,
      storeId: STORE_ID,
    })

    await expect(promise).rejects.toBeInstanceOf(StorefrontResolutionError)
    await promise.catch((error: StorefrontResolutionError) => {
      expect(error.status).toBe(403)
      expect(error.code).toBe('store_out_of_scope')
    })
  })

  it('(e) resolves the anonymous scope for a guest, with and without a store', async () => {
    const harness = createHarness({})
    const service = createStoreContextService(harness.container)

    const withoutStore = await service.resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(withoutStore.customerUserId).toBeNull()
    expect(withoutStore.customerId).toBeNull()
    expect(withoutStore.customerIds).toEqual([])
    expect(withoutStore.customerGroupIds).toEqual([])
    expect(withoutStore.priceKindId).toBeNull()
    expect(withoutStore.taxMode).toBeNull()
    expect(withoutStore.currencyCode).toBeNull()
    expect('assortmentScope' in withoutStore).toBe(false)

    mockedLoadStoreChannelForBuyer.mockResolvedValue({
      currencyCode: 'USD',
      priceDisplayModeDefault: 'gross',
      channel: { priceKindId: 'kind-channel', assortmentScope: null, requireAuthentication: true },
    } satisfies StoreChannelForBuyer)

    const withClosedStore = await service.resolveForBuyer({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
    })
    expect(withClosedStore.customerGroupIds).toEqual([])
    expect(withClosedStore.priceKindId).toBe('kind-channel')
    expect(withClosedStore.currencyCode).toBe('USD')
    expect(withClosedStore.assortmentScope).toEqual([])
  })

  it('(f) never reads or writes the buyer\'s own 60s cache', async () => {
    const harness = createHarness({
      users: [user('user-1', 'person-1', 'company-1')],
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'], priceKindId: 'kind-a' } },
    })
    mockedLoadStoreChannelForBuyer.mockResolvedValue({
      currencyCode: 'EUR',
      priceDisplayModeDefault: 'gross',
      channel: { priceKindId: null, assortmentScope: null, requireAuthentication: false },
    } satisfies StoreChannelForBuyer)
    const service = createStoreContextService(harness.container)

    await service.resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' })
    await service.resolveForBuyer({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      customerUserId: 'user-1',
    })

    expect(harness.cache.get).not.toHaveBeenCalled()
    expect(harness.cache.set).not.toHaveBeenCalled()
  })
})
