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
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import {
  createStoreContextService,
  type ResolveForBuyerInput,
  type ResolveForBuyerResult,
  type StoreContextService,
} from '../storeContextService'
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
const actualLoadStoreChannelForBuyer = jest.requireActual<typeof import('../storeContext')>('../storeContext')
  .loadStoreChannelForBuyer

const ERROR_MARKER = Symbol.for('@open-mercato/ecommerce/StorefrontResolutionError')

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
  isActive: boolean
  deletedAt: Date | null
}

type EntityRow = {
  id: string
  kind: 'person' | 'company'
  tenantId: string
  organizationId: string
  deletedAt: Date | null
}

type GroupFixture = {
  groupIds: string[]
  priceKindId?: string | null
  scope?: EffectiveAssortmentScope
}

type HarnessOptions = {
  users?: UserRow[]
  entities?: EntityRow[]
  personCompanies?: Record<string, string | null>
  storeRows?: Record<string, unknown>[]
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
  const queries: CompiledQuery[] = []
  const executor = db.getExecutor() as unknown as { executeQuery: (query: CompiledQuery) => Promise<{ rows: unknown[] }> }
  executor.executeQuery = async (query) => {
    queries.push(query)
    if (query.sql.includes('"customer_people"')) {
      const personId = String(query.parameters[0])
      return { rows: personId in (options.personCompanies ?? {}) ? [{ company_entity_id: options.personCompanies?.[personId] ?? null }] : [] }
    }
    if (query.sql.includes('"ecommerce_stores"')) return { rows: options.storeRows ?? [] }
    return { rows: [] }
  }

  const users = options.users ?? []
  const entities = options.entities ?? []
  const priceKinds = options.priceKinds ?? {}
  const inScope = (row: { tenantId: string; organizationId: string }, where: Record<string, unknown>) =>
    row.tenantId === where.tenantId && row.organizationId === where.organizationId
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === CustomerUser) {
      return (
        users.find(
          (row) =>
            row.id === where.id &&
            inScope(row, where) &&
            (where.isActive === undefined || row.isActive === where.isActive) &&
            (where.deletedAt === undefined || row.deletedAt === where.deletedAt),
        ) ?? null
      )
    }
    if (entity === CustomerEntity) {
      return (
        entities.find(
          (row) =>
            row.id === where.id &&
            inScope(row, where) &&
            (where.kind === undefined || row.kind === where.kind) &&
            (where.deletedAt === undefined || row.deletedAt === where.deletedAt),
        ) ?? null
      )
    }
    if (entity === CatalogPriceKind) {
      const displayMode = priceKinds[String(where.id)]
      return displayMode ? { id: where.id, displayMode } : null
    }
    return null
  })
  const em = {
    findOne,
    getKysely: () => db,
    getMetadata: () => ({ find: (entity: unknown) => ({ class: entity }) }),
  }

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
  return { container, cache, customerGroupsService, queries }
}

function user(id: string, personEntityId: string | null, customerEntityId: string | null, overrides: Partial<UserRow> = {}): UserRow {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    personEntityId,
    customerEntityId,
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function entity(id: string, kind: EntityRow['kind'], overrides: Partial<EntityRow> = {}): EntityRow {
  return { id, kind, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null, ...overrides }
}

function openStore(overrides: Partial<StoreChannelForBuyer> = {}): StoreChannelForBuyer {
  return {
    currencyCode: 'EUR',
    priceDisplayModeDefault: 'gross',
    channel: { priceKindId: null, assortmentScope: null, requireAuthentication: false },
    ...overrides,
  }
}

function trustedResolver(service: StoreContextService): (input: ResolveForBuyerInput) => Promise<ResolveForBuyerResult> {
  const method = service.resolveForBuyer
  if (!method) throw new Error('[internal] resolveForBuyer missing')
  return method.bind(service)
}

async function expectRefusal(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(StorefrontResolutionError)
  expect(error).toMatchObject({ status, code })
}

describe('storeContextService.resolveForBuyer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedLoadStoreChannelForBuyer.mockReset()
  })

  it('resolves a known buyer\'s groups/price kind/currency without a store', async () => {
    const harness = createHarness({
      users: [user('user-1', 'person-1', 'company-1')],
      entities: [entity('person-1', 'person'), entity('company-1', 'company')],
      priceKinds: { 'kind-a': 'excluding-tax' },
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'], priceKindId: 'kind-a' } },
    })
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' })

    expect(mockedLoadStoreChannelForBuyer).not.toHaveBeenCalled()
    expect(result.storeId).toBeNull()
    expect(result.customerUserId).toBe('user-1')
    expect(result.customerId).toBe('person-1')
    expect(result.customerIds).toEqual(['person-1', 'company-1'])
    expect(result.customerGroupIds).toEqual(['group-1'])
    expect(result.priceKindId).toBe('kind-a')
    expect(result.taxMode).toBe('net')
    expect(result.currencyCode).toBeNull()
    expect('assortmentScope' in result).toBe(false)
    expect(result.buyerDigest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('resolves with a store and gets assortmentScope', async () => {
    const harness = createHarness({
      users: [user('user-1', 'person-1', 'company-1')],
      entities: [entity('person-1', 'person'), entity('company-1', 'company')],
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'], scope: null } },
    })
    mockedLoadStoreChannelForBuyer.mockResolvedValue(openStore())
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const result = await resolveForBuyer({
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
    expect(result.taxMode).toBe('gross')
    expect('assortmentScope' in result).toBe(true)
    expect(result.assortmentScope).toBeNull()
  })

  describe('store_out_of_scope', () => {
    const scopedStore = async (_container: unknown, input: { tenantId: string; organizationId: string }) =>
      input.tenantId === TENANT_ID && input.organizationId === ORG_ID ? openStore() : null

    it('refuses a store of a second tenant', async () => {
      mockedLoadStoreChannelForBuyer.mockImplementation(scopedStore)
      const resolveForBuyer = trustedResolver(createStoreContextService(createHarness().container))
      await expectRefusal(
        resolveForBuyer({ tenantId: OTHER_TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID }),
        403,
        'store_out_of_scope',
      )
    })

    it('refuses a store of another organization in the same tenant', async () => {
      mockedLoadStoreChannelForBuyer.mockImplementation(scopedStore)
      const resolveForBuyer = trustedResolver(createStoreContextService(createHarness().container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, storeId: STORE_ID }),
        403,
        'store_out_of_scope',
      )
    })

    it('refuses a deleted or missing store (no row)', async () => {
      mockedLoadStoreChannelForBuyer.mockResolvedValue(null)
      const resolveForBuyer = trustedResolver(createStoreContextService(createHarness().container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID }),
        403,
        'store_out_of_scope',
      )
    })
  })

  describe('store_misconfigured (D-R5-SF3)', () => {
    it('refuses a store with no usable default channel binding instead of returning a null channel', async () => {
      const harness = createHarness({ users: [user('user-1', 'person-1', 'company-1')] })
      mockedLoadStoreChannelForBuyer.mockResolvedValue(openStore({ channel: null }))
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, customerUserId: 'user-1' }),
        503,
        'store_misconfigured',
      )
      expect(harness.customerGroupsService.resolveGroups).not.toHaveBeenCalled()
    })

    const storeRow = (overrides: Record<string, unknown>) => ({
      store_default_currency_code: 'EUR',
      store_settings: {},
      channel_binding_id: 'binding-1',
      channel_price_kind_id: 'kind-channel',
      channel_assortment_scope: null,
      channel_require_authentication: false,
      channel_live_sales_channel_id: 'sales-channel-1',
      ...overrides,
    })

    it('loadStoreChannelForBuyer reports no channel when the default binding is missing', async () => {
      const harness = createHarness({
        storeRows: [storeRow({ channel_binding_id: null, channel_live_sales_channel_id: null })],
      })
      const result = await actualLoadStoreChannelForBuyer(harness.container, {
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })
      expect(result).not.toBeNull()
      expect(result?.channel).toBeNull()
    })

    it('loadStoreChannelForBuyer reports no channel when the binding\'s sales channel was deleted', async () => {
      const harness = createHarness({ storeRows: [storeRow({ channel_live_sales_channel_id: null })] })
      const result = await actualLoadStoreChannelForBuyer(harness.container, {
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })
      expect(result?.channel).toBeNull()
    })

    it('loadStoreChannelForBuyer scopes the store, binding and sales channel to the tenant and organization', async () => {
      const harness = createHarness({ storeRows: [storeRow({})] })
      const result = await actualLoadStoreChannelForBuyer(harness.container, {
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })
      expect(result?.channel).toEqual({ priceKindId: 'kind-channel', assortmentScope: null, requireAuthentication: false })
      const [query] = harness.queries
      expect(query.sql).toContain('left join "sales_channels" as "sc"')
      expect(query.sql).toContain('"sc"."tenant_id" = "c"."tenant_id"')
      expect(query.sql).toContain('"sc"."organization_id" = "c"."organization_id"')
      expect(query.sql).toContain('"sc"."deleted_at" is null')
      expect(query.sql).toContain('"c"."tenant_id" = "s"."tenant_id"')
      expect(query.sql).toContain('"s"."tenant_id" = $')
      expect(query.sql).toContain('"s"."organization_id" = $')
      expect(query.sql).toContain('"s"."deleted_at" is null')
      expect(query.parameters).toEqual(expect.arrayContaining([STORE_ID, TENANT_ID, ORG_ID]))
    })

    it('loadStoreChannelForBuyer answers null when no store row is in scope', async () => {
      const harness = createHarness({ storeRows: [] })
      const result = await actualLoadStoreChannelForBuyer(harness.container, {
        storeId: STORE_ID,
        tenantId: OTHER_TENANT_ID,
        organizationId: ORG_ID,
      })
      expect(result).toBeNull()
    })
  })

  describe('buyer_out_of_scope', () => {
    it('refuses a customerUserId of a second tenant', async () => {
      const harness = createHarness({ users: [user('user-1', 'person-1', null, { tenantId: OTHER_TENANT_ID })] })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses an inactive CustomerUser', async () => {
      const harness = createHarness({ users: [user('user-1', 'person-1', null, { isActive: false })] })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses a deleted CustomerUser', async () => {
      const harness = createHarness({ users: [user('user-1', 'person-1', null, { deletedAt: new Date() })] })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses a customerId of a second tenant', async () => {
      const harness = createHarness({ entities: [entity('person-1', 'person', { tenantId: OTHER_TENANT_ID })] })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: 'person-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses a deleted customerId entity', async () => {
      const harness = createHarness({ entities: [entity('person-1', 'person', { deletedAt: new Date() })] })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: 'person-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses a customerId that is not one of the given user\'s ids', async () => {
      const harness = createHarness({ users: [user('user-1', 'person-1', 'company-1')] })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1', customerId: 'person-2' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses a customerId of the given user when its CRM record was soft-deleted', async () => {
      const harness = createHarness({
        users: [user('user-1', 'person-1', 'company-1')],
        entities: [entity('person-1', 'person', { deletedAt: new Date() }), entity('company-1', 'company')],
      })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1', customerId: 'person-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('refuses a customerId of the given user when its CRM record lives in another organization', async () => {
      const harness = createHarness({
        users: [user('user-1', 'person-1', 'company-1')],
        entities: [entity('person-1', 'person', { organizationId: OTHER_ORG_ID })],
      })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
      await expectRefusal(
        resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1', customerId: 'person-1' }),
        403,
        'buyer_out_of_scope',
      )
    })

    it('resolves a customerId of the given user when its CRM record is live in scope', async () => {
      const harness = createHarness({
        users: [user('user-1', 'person-1', 'company-1')],
        entities: [entity('person-1', 'person'), entity('company-1', 'company')],
      })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      const result = await resolveForBuyer({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        customerUserId: 'user-1',
        customerId: 'person-1',
      })

      expect(result.customerUserId).toBe('user-1')
      expect(result.customerIds).toEqual(['person-1', 'company-1'])
    })
  })

  describe('customerId only', () => {
    it('drops a primary company that lives in another organization of the same tenant', async () => {
      const harness = createHarness({
        entities: [entity('person-1', 'person'), entity('company-1', 'company', { organizationId: OTHER_ORG_ID })],
        personCompanies: { 'person-1': 'company-1' },
        groupsByCustomer: { 'company-1': { groupIds: ['group-b2b'], priceKindId: 'kind-b2b' } },
      })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: 'person-1' })

      expect(result.customerIds).toEqual(['person-1'])
      expect(result.customerGroupIds).toEqual([])
      expect(result.priceKindId).toBeNull()
    })

    it('drops a soft-deleted primary company', async () => {
      const harness = createHarness({
        entities: [entity('person-1', 'person'), entity('company-1', 'company', { deletedAt: new Date() })],
        personCompanies: { 'person-1': 'company-1' },
        groupsByCustomer: { 'company-1': { groupIds: ['group-b2b'] } },
      })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: 'person-1' })

      expect(result.customerIds).toEqual(['person-1'])
      expect(result.customerGroupIds).toEqual([])
    })

    it('drops a primary company link that points at a person record', async () => {
      const harness = createHarness({
        entities: [entity('person-1', 'person'), entity('person-2', 'person')],
        personCompanies: { 'person-1': 'person-2' },
      })
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: 'person-1' })

      expect(result.customerIds).toEqual(['person-1'])
    })

    it('resolves a person with its primary company and counts as authenticated for scope', async () => {
      const harness = createHarness({
        entities: [entity('person-1', 'person'), entity('company-1', 'company')],
        personCompanies: { 'person-1': 'company-1' },
        groupsByCustomer: { 'company-1': { groupIds: ['group-b2b'], scope: null } },
      })
      mockedLoadStoreChannelForBuyer.mockResolvedValue(
        openStore({ channel: { priceKindId: null, assortmentScope: null, requireAuthentication: true } }),
      )
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      const result = await resolveForBuyer({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        storeId: STORE_ID,
        customerId: 'person-1',
      })

      expect(result.customerUserId).toBeNull()
      expect(result.customerId).toBe('person-1')
      expect(result.customerIds).toEqual(['person-1', 'company-1'])
      expect(result.customerGroupIds).toEqual(['group-b2b'])
      expect(result.assortmentScope).toBeNull()
    })

    it('resolves a person with no customer_people row alone', async () => {
    const harness = createHarness({ entities: [entity('person-1', 'person')] })
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: 'person-1' })

    expect(result.customerId).toBe('person-1')
    expect(result.customerIds).toEqual(['person-1'])
  })

  it('resolves a company alone and counts as authenticated for scope', async () => {
      const harness = createHarness({ entities: [entity('company-1', 'company')] })
      mockedLoadStoreChannelForBuyer.mockResolvedValue(
        openStore({ channel: { priceKindId: null, assortmentScope: null, requireAuthentication: true } }),
      )
      const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

      const result = await resolveForBuyer({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        storeId: STORE_ID,
        customerId: 'company-1',
      })

      expect(result.customerIds).toEqual(['company-1'])
      expect(result.assortmentScope).toBeNull()
      expect(harness.queries.some((query) => query.sql.includes('"customer_people"'))).toBe(false)
    })
  })

  it('a refresh with customerUserId alone returns the relinked person (D-R5-SF2)', async () => {
    const relinked = user('user-1', 'person-old', 'company-1')
    const harness = createHarness({
      users: [relinked],
      entities: [entity('person-old', 'person'), entity('person-new', 'person'), entity('company-1', 'company')],
    })
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const before = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' })
    relinked.personEntityId = 'person-new'
    const after = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' })

    expect(before.customerIds).toEqual(['person-old', 'company-1'])
    expect(after.customerId).toBe('person-new')
    expect(after.customerIds).toEqual(['person-new', 'company-1'])
  })

  it('without a store, a buyer whose group sets no price kind gets priceKindId and taxMode null', async () => {
    const harness = createHarness({
      users: [user('user-1', 'person-1', null)],
      entities: [entity('person-1', 'person')],
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'] } },
    })
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' })

    expect(result.customerGroupIds).toEqual(['group-1'])
    expect(result.priceKindId).toBeNull()
    expect(result.taxMode).toBeNull()
    expect('assortmentScope' in result).toBe(false)
  })

  it('resolves the anonymous scope for a guest, with and without a store', async () => {
    const harness = createHarness({})
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const withoutStore = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(withoutStore.customerUserId).toBeNull()
    expect(withoutStore.customerId).toBeNull()
    expect(withoutStore.customerIds).toEqual([])
    expect(withoutStore.customerGroupIds).toEqual([])
    expect(withoutStore.priceKindId).toBeNull()
    expect(withoutStore.taxMode).toBeNull()
    expect(withoutStore.currencyCode).toBeNull()
    expect('assortmentScope' in withoutStore).toBe(false)

    mockedLoadStoreChannelForBuyer.mockResolvedValue(
      openStore({
        currencyCode: 'USD',
        channel: { priceKindId: 'kind-channel', assortmentScope: null, requireAuthentication: true },
      }),
    )
    const withClosedStore = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID })
    expect(withClosedStore.customerGroupIds).toEqual([])
    expect(withClosedStore.priceKindId).toBe('kind-channel')
    expect(withClosedStore.currencyCode).toBe('USD')
    expect(withClosedStore.assortmentScope).toEqual([])
  })

  it('gives every guest call its own identity, so mutating one result cannot leak into the next', async () => {
    const harness = createHarness({})
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const first = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID })
    first.customerIds.push('injected-customer')
    const second = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(second.customerIds).toEqual([])
    expect(second.customerIds).not.toBe(first.customerIds)
    expect(second.customerGroupIds).toEqual([])
  })

  it('resolves a guest on an open store to the channel scope', async () => {
    const harness = createHarness({})
    mockedLoadStoreChannelForBuyer.mockResolvedValue(
      openStore({
        channel: { priceKindId: 'kind-channel', assortmentScope: { categoryIds: ['cat-1'] }, requireAuthentication: false },
      }),
    )
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const result = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID })

    expect(result.customerGroupIds).toEqual([])
    expect(result.priceKindId).toBe('kind-channel')
    expect(result.assortmentScope).not.toEqual([])
    expect(result.assortmentScope).not.toBeNull()
  })

  it('buyerDigest is stable for the same identity and changes with groups and store', async () => {
    const groupsByCustomer: Record<string, GroupFixture> = { 'person-1': { groupIds: ['group-b', 'group-a'] } }
    const harness = createHarness({
      users: [user('user-1', 'person-1', null)],
      entities: [entity('person-1', 'person')],
      groupsByCustomer,
    })
    mockedLoadStoreChannelForBuyer.mockResolvedValue(openStore())
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))
    const input = { tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' }

    const first = await resolveForBuyer(input)
    const repeat = await resolveForBuyer(input)
    groupsByCustomer['person-1'] = { groupIds: ['group-a'] }
    const fewerGroups = await resolveForBuyer(input)
    const withStore = await resolveForBuyer({ ...input, storeId: STORE_ID })

    expect(repeat.buyerDigest).toBe(first.buyerDigest)
    expect(fewerGroups.buyerDigest).not.toBe(first.buyerDigest)
    expect(withStore.buyerDigest).not.toBe(fewerGroups.buyerDigest)
  })

  it('never reads or writes the buyer\'s own 60s cache, and sees a membership change at once', async () => {
    const groupsByCustomer: Record<string, GroupFixture> = { 'person-1': { groupIds: ['group-1'] } }
    const harness = createHarness({
      users: [user('user-1', 'person-1', 'company-1')],
      entities: [entity('person-1', 'person'), entity('company-1', 'company')],
      groupsByCustomer,
    })
    mockedLoadStoreChannelForBuyer.mockResolvedValue(openStore())
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const first = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'user-1' })
    groupsByCustomer['person-1'] = { groupIds: ['group-1', 'group-2'] }
    const second = await resolveForBuyer({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      customerUserId: 'user-1',
    })

    expect(first.customerGroupIds).toEqual(['group-1'])
    expect(second.customerGroupIds).toEqual(['group-1', 'group-2'])
    expect(harness.cache.get).not.toHaveBeenCalled()
    expect(harness.cache.set).not.toHaveBeenCalled()
  })

  it('a refusal carries status, code and the Symbol.for marker that a marker-only check recognises', async () => {
    const harness = createHarness({})
    const resolveForBuyer = trustedResolver(createStoreContextService(harness.container))

    const error = await resolveForBuyer({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'missing' }).then(
      () => null,
      (caught: unknown) => caught,
    )

    const readsMarkerOnly = (value: unknown): boolean =>
      typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[ERROR_MARKER] === true
    expect(readsMarkerOnly(error)).toBe(true)
    expect(error).toMatchObject({ status: 403, code: 'buyer_out_of_scope' })
  })
})
