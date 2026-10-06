import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import type { CacheStrategy } from '@open-mercato/cache'
import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { ecommerceStoreSettingsSchema, type EcommercePriceDisplayMode } from '../../data/validators'
import { emitEcommerceEvent } from '../../events'
import { composeStoreContext, resolveBuyerContext, type BuyerContextContainer } from '../buyerContext'
import { BUYER_CONTEXT_TTL_MS } from '../cacheKeys'
import { StorefrontResolutionError, type ResolvedStore } from '../storeContext'

jest.mock('../../events', () => ({
  emitEcommerceEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
  ) => em.findOne(entity, where),
}))

const mockedEmit = emitEcommerceEvent as jest.Mock
const mockedAuth = getCustomerAuthFromRequest as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '99999999-9999-4999-8999-999999999999'
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
  allowPurchaseOnAccount?: boolean
  approvalRequiredAbove?: number | null
  scope?: EffectiveAssortmentScope
}

type HarnessOptions = {
  users?: UserRow[]
  priceKinds?: Record<string, string>
  groupsByCustomer?: Record<string, GroupFixture>
  defaultGroup?: GroupFixture
  overlayCustomerIds?: string[]
}

function createHarness(options: HarnessOptions = {}) {
  const queries: CompiledQuery[] = []
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<Record<string, never>>) => new PostgresIntrospector(instance),
    },
  })
  const executor = db.getExecutor() as unknown as { executeQuery: (query: CompiledQuery) => Promise<{ rows: unknown[] }> }
  executor.executeQuery = async (query: CompiledQuery) => {
    queries.push(query)
    const overlay = (options.overlayCustomerIds ?? []).filter((id) => query.parameters.includes(id))
    return { rows: [...overlay].reverse().map((id) => ({ customer_id: id })) }
  }

  const users = options.users ?? []
  const priceKinds = options.priceKinds ?? {}
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === CustomerUser) {
      return (
        users.find(
          (user) =>
            user.id === where.id && user.tenantId === where.tenantId && user.organizationId === where.organizationId,
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

  const defaultGroup: GroupFixture = options.defaultGroup ?? { groupIds: ['group-default'], scope: null }
  const fixtureFor = (customerIds: string[] | undefined): GroupFixture => {
    const ids = customerIds ?? []
    if (ids.length === 0) return defaultGroup
    const fixtures = ids.map((id) => options.groupsByCustomer?.[id]).filter((entry): entry is GroupFixture => !!entry)
    if (fixtures.length === 0) return defaultGroup
    return {
      groupIds: Array.from(new Set(fixtures.flatMap((entry) => entry.groupIds))),
      priceKindId: fixtures.find((entry) => entry.priceKindId !== undefined)?.priceKindId ?? null,
      allowPurchaseOnAccount: fixtures.some((entry) => entry.allowPurchaseOnAccount === true),
      approvalRequiredAbove: fixtures.find((entry) => entry.approvalRequiredAbove != null)?.approvalRequiredAbove ?? null,
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
        allowPurchaseOnAccount: fixture.allowPurchaseOnAccount ?? false,
        approvalRequiredAbove: fixture.approvalRequiredAbove ?? null,
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

  const entries = new Map<string, unknown>()
  const cacheSets: Array<{ key: string; ttl?: number; tags?: string[] }> = []
  const cache = {
    async get(key: string) {
      return entries.has(key) ? entries.get(key) : null
    },
    async set(key: string, value: unknown, setOptions?: { ttl?: number; tags?: string[] }) {
      cacheSets.push({ key, ttl: setOptions?.ttl, tags: setOptions?.tags })
      entries.set(key, JSON.parse(JSON.stringify(value)))
    },
    async deleteByTags() {
      return 0
    },
  } as unknown as CacheStrategy

  const services: Record<string, unknown> = { em, cache, customerGroupsService }
  const container: BuyerContextContainer = {
    resolve: (name: string) => {
      if (!(name in services)) throw new Error(`[internal] unregistered ${name}`)
      return services[name]
    },
  }
  return { container, queries, cacheSets, findOne, customerGroupsService, entries }
}

function resolvedStore(
  overrides: {
    channelPriceKindId?: string | null
    channelScope?: AssortmentScope | null
    requireAuthentication?: boolean
    priceDisplayModeDefault?: EcommercePriceDisplayMode
    effectiveLocale?: string
  } = {},
): ResolvedStore {
  const settings = ecommerceStoreSettingsSchema.parse({
    display: { priceDisplayModeDefault: overrides.priceDisplayModeDefault ?? 'gross' },
  })
  return {
    source: 'host',
    store: {
      id: STORE_ID,
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'de'],
      defaultCurrencyCode: 'EUR',
      settings,
    },
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: {
      channelBindingId: 'channel-binding-1',
      salesChannelId: 'sales-channel-1',
      priceKindId: overrides.channelPriceKindId === undefined ? 'kind-retail' : overrides.channelPriceKindId,
      priceSortFallback: 'approximate',
      assortmentScope: overrides.channelScope ?? null,
      requireAuthentication: overrides.requireAuthentication ?? false,
    },
    domain: null,
    effectiveLocale: overrides.effectiveLocale ?? 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
  }
}

function sessionFor(sub: string, overrides: Record<string, unknown> = {}) {
  return {
    sub,
    sid: 'session-1',
    type: 'customer',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    email: 'buyer@example.com',
    displayName: 'Buyer',
    customerEntityId: null,
    personEntityId: null,
    resolvedFeatures: [],
    isPortalAdmin: false,
    ...overrides,
  }
}

function user(id: string, personEntityId: string | null, customerEntityId: string | null): UserRow {
  return { id, tenantId: TENANT_ID, organizationId: ORG_ID, personEntityId, customerEntityId }
}

const request = () => new Request('https://shop.example.com/', { headers: { host: 'shop.example.com' } })

async function expectResolutionError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(StorefrontResolutionError)
  expect((error as StorefrontResolutionError).status).toBe(status)
  expect((error as StorefrontResolutionError).code).toBe(code)
}

describe('resolveBuyerContext', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAuth.mockResolvedValue(null)
  })

  it('resolves an anonymous buyer to the default group with the channel price kind tax mode', async () => {
    const harness = createHarness({ priceKinds: { 'kind-retail': 'excluding-tax' } })

    const buyer = await resolveBuyerContext(harness.container, resolvedStore(), request())

    expect(buyer).toMatchObject({
      customerUserId: null,
      customerId: null,
      companyId: null,
      customerIds: [],
      customerGroupIds: ['group-default'],
      isAuthenticated: false,
      priceKindId: 'kind-retail',
      taxMode: 'net',
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: null,
      assortmentScope: null,
      customerOverlayId: null,
    })
    expect(harness.customerGroupsService.resolveGroups).toHaveBeenCalledWith({
      customerId: null,
      customerIds: [],
      tenantId: TENANT_ID,
    })
    expect(harness.queries).toHaveLength(0)
  })

  it('falls back to the store display default when no price kind resolves', async () => {
    const harness = createHarness()

    const buyer = await resolveBuyerContext(
      harness.container,
      resolvedStore({ channelPriceKindId: null, priceDisplayModeDefault: 'net' }),
      null,
    )

    expect(buyer.priceKindId).toBeNull()
    expect(buyer.taxMode).toBe('net')
    expect(harness.findOne).not.toHaveBeenCalled()
  })

  it('derives taxMode from the group override price kind, not the channel default', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', 'company-1')],
      priceKinds: { 'kind-retail': 'including-tax', 'kind-wholesale': 'excluding-tax' },
      groupsByCustomer: {
        'company-1': {
          groupIds: ['group-b2b'],
          priceKindId: 'kind-wholesale',
          allowPurchaseOnAccount: true,
          approvalRequiredAbove: 5000,
        },
      },
    })
    mockedAuth.mockResolvedValue(sessionFor('cu-1'))

    const buyer = await resolveBuyerContext(harness.container, resolvedStore(), request())

    expect(buyer.priceKindId).toBe('kind-wholesale')
    expect(buyer.taxMode).toBe('net')
    expect(buyer.customerGroupIds).toEqual(['group-b2b'])
    expect(buyer.allowPurchaseOnAccount).toBe(true)
    expect(buyer.approvalRequiredAbove).toBe(5000)
    expect(harness.customerGroupsService.resolveTerms).toHaveBeenCalledWith(
      expect.objectContaining({ customerIds: ['person-1', 'company-1'], groupIds: ['group-b2b'], tenantId: TENANT_ID }),
    )
  })

  it('rejects a portal session issued for another tenant or organization with 401', async () => {
    const harness = createHarness({ users: [user('cu-1', 'person-1', null)] })

    mockedAuth.mockResolvedValue(sessionFor('cu-1', { tenantId: OTHER_ID }))
    await expectResolutionError(
      resolveBuyerContext(harness.container, resolvedStore(), request()),
      401,
      'portal_session_scope_mismatch',
    )

    mockedAuth.mockResolvedValue(sessionFor('cu-1', { orgId: OTHER_ID }))
    await expectResolutionError(
      resolveBuyerContext(harness.container, resolvedStore(), request()),
      401,
      'portal_session_scope_mismatch',
    )
    expect(harness.findOne).not.toHaveBeenCalled()
  })

  it('rejects a valid session whose customer user no longer resolves with 401', async () => {
    const harness = createHarness()
    mockedAuth.mockResolvedValue(sessionFor('cu-missing'))

    await expectResolutionError(
      resolveBuyerContext(harness.container, resolvedStore(), request()),
      401,
      'portal_session_invalid',
    )
  })

  it('reads identity from the customer user row and ignores stale JWT entity ids', async () => {
    const harness = createHarness({ users: [user('cu-1', 'person-fresh', 'company-fresh')] })
    mockedAuth.mockResolvedValue(
      sessionFor('cu-1', { personEntityId: 'person-stale', customerEntityId: 'company-stale' }),
    )

    const buyer = await resolveBuyerContext(harness.container, resolvedStore(), request())

    expect(buyer.customerUserId).toBe('cu-1')
    expect(buyer.customerId).toBe('person-fresh')
    expect(buyer.companyId).toBe('company-fresh')
    expect(buyer.customerIds).toEqual(['person-fresh', 'company-fresh'])
    expect(harness.customerGroupsService.resolveGroups).toHaveBeenCalledWith({
      customerId: 'person-fresh',
      customerIds: ['person-fresh', 'company-fresh'],
      tenantId: TENANT_ID,
    })
  })

  it('unions person and company with the person first and falls back to the company id', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', 'company-1'), user('cu-2', null, 'company-2'), user('cu-3', 'same', 'same')],
    })

    mockedAuth.mockResolvedValue(sessionFor('cu-2'))
    const companyOnly = await resolveBuyerContext(harness.container, resolvedStore(), request())
    expect(companyOnly).toMatchObject({ customerId: 'company-2', companyId: 'company-2', customerIds: ['company-2'] })

    mockedAuth.mockResolvedValue(sessionFor('cu-3'))
    const duplicated = await resolveBuyerContext(harness.container, resolvedStore(), request())
    expect(duplicated.customerIds).toEqual(['same'])

    mockedAuth.mockResolvedValue(sessionFor('cu-1'))
    const both = await resolveBuyerContext(harness.container, resolvedStore(), request())
    expect(both).toMatchObject({ customerId: 'person-1', companyId: 'company-1', customerIds: ['person-1', 'company-1'] })
  })

  it('leaves customerOverlayId null without own price rows and orders it person first with rows', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', 'company-1'), user('cu-2', 'person-2', 'company-2')],
      overlayCustomerIds: ['person-1', 'company-1'],
    })

    mockedAuth.mockResolvedValue(sessionFor('cu-1'))
    const withRows = await resolveBuyerContext(harness.container, resolvedStore(), request())
    expect(withRows.customerOverlayId).toBe('person-1,company-1')
    const overlayQuery = harness.queries.find((query) => query.sql.includes('catalog_product_variant_prices'))
    expect(overlayQuery?.sql).toContain('select distinct "customer_id"')
    expect(overlayQuery?.parameters).toEqual(['person-1', 'company-1', TENANT_ID, ORG_ID])

    mockedAuth.mockResolvedValue(sessionFor('cu-2'))
    const withoutRows = await resolveBuyerContext(harness.container, resolvedStore(), request())
    expect(withoutRows.customerOverlayId).toBeNull()
  })

  it('serves a cached buyer layer without re-resolving identity, groups or prices', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', 'company-1')],
      groupsByCustomer: { 'person-1': { groupIds: ['group-vip'] } },
    })
    mockedAuth.mockResolvedValue(sessionFor('cu-1'))

    const first = await resolveBuyerContext(harness.container, resolvedStore(), request())
    const callsAfterFirst = {
      findOne: harness.findOne.mock.calls.length,
      groups: harness.customerGroupsService.resolveGroups.mock.calls.length,
      queries: harness.queries.length,
    }
    const second = await resolveBuyerContext(harness.container, resolvedStore(), request())

    expect(second).toEqual(first)
    expect(harness.findOne.mock.calls.length).toBe(callsAfterFirst.findOne)
    expect(harness.customerGroupsService.resolveGroups.mock.calls.length).toBe(callsAfterFirst.groups)
    expect(harness.queries.length).toBe(callsAfterFirst.queries)
    const buyerSet = harness.cacheSets.find((entry) => entry.key.startsWith('ecommerce:buyer:'))
    expect(buyerSet?.key).toBe(`ecommerce:buyer:${STORE_ID}:cu-1`)
    expect(buyerSet?.ttl).toBe(BUYER_CONTEXT_TTL_MS)
    expect(buyerSet?.tags).toEqual(
      expect.arrayContaining([
        `ecommerce-store:${STORE_ID}`,
        'customer:person-1',
        'customer:company-1',
        'customer-group:group-vip',
      ]),
    )
  })

  it('caches anonymous buyers under the anonymous segment with default group tags', async () => {
    const harness = createHarness()

    await resolveBuyerContext(harness.container, resolvedStore(), null)
    await resolveBuyerContext(harness.container, resolvedStore(), null)

    expect(harness.customerGroupsService.resolveGroups).toHaveBeenCalledTimes(1)
    const buyerSet = harness.cacheSets.find((entry) => entry.key.startsWith('ecommerce:buyer:'))
    expect(buyerSet?.key).toBe(`ecommerce:buyer:${STORE_ID}:anonymous`)
    expect(buyerSet?.tags).toEqual(expect.arrayContaining([`ecommerce-store:${STORE_ID}`, 'customer-group:group-default']))
  })

  it('intersects the channel scope with the buyer scope', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', null)],
      groupsByCustomer: { 'person-1': { groupIds: ['group-1'], scope: [{ categoryIds: ['cat-b2b'] }] } },
    })
    mockedAuth.mockResolvedValue(sessionFor('cu-1'))

    const buyer = await resolveBuyerContext(
      harness.container,
      resolvedStore({ channelScope: { excludeTagIds: ['tag-hidden'] } }),
      request(),
    )

    expect(Array.isArray(buyer.assortmentScope)).toBe(true)
    expect(buyer.assortmentScope).toHaveLength(1)
    expect(buyer.assortmentScopeHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('emits the empty assortment event once per store, binding and hash for authenticated buyers', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', null), user('cu-2', 'person-2', null)],
      groupsByCustomer: {
        'person-1': { groupIds: ['group-1'], scope: [] },
        'person-2': { groupIds: ['group-2'], scope: [] },
      },
      defaultGroup: { groupIds: ['group-default'], scope: [] },
    })

    await resolveBuyerContext(harness.container, resolvedStore(), null)
    expect(mockedEmit).not.toHaveBeenCalled()

    mockedAuth.mockResolvedValue(sessionFor('cu-1'))
    const first = await resolveBuyerContext(harness.container, resolvedStore(), request())
    mockedAuth.mockResolvedValue(sessionFor('cu-2'))
    await resolveBuyerContext(harness.container, resolvedStore(), request())

    expect(first.assortmentScope).toEqual([])
    expect(mockedEmit).toHaveBeenCalledTimes(1)
    const [eventId, payload] = mockedEmit.mock.calls[0]
    expect(eventId).toBe('ecommerce.assortment.empty_detected')
    expect(payload).toEqual({
      id: STORE_ID,
      storeId: STORE_ID,
      channelBindingId: 'channel-binding-1',
      assortmentScopeHash: first.assortmentScopeHash,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(JSON.stringify(payload)).not.toContain('person-')
  })

  describe('channel binding requireAuthentication', () => {
    function expectGroupsNeverConsulted(harness: ReturnType<typeof createHarness>) {
      expect(harness.customerGroupsService.resolveGroups).not.toHaveBeenCalled()
      expect(harness.customerGroupsService.resolveTerms).not.toHaveBeenCalled()
      expect(harness.customerGroupsService.resolveAssortmentScope).not.toHaveBeenCalled()
    }

    it('resolves an anonymous buyer to an empty assortment without consulting customer_groups', async () => {
      const harness = createHarness({ defaultGroup: { groupIds: ['group-default'], scope: [{ categoryIds: ['cat-open'] }] } })

      const buyer = await resolveBuyerContext(harness.container, resolvedStore({ requireAuthentication: true }), null)

      expect(buyer.assortmentScope).toEqual([])
      expect(buyer.assortmentScopeHash).toMatch(/^[0-9a-f]{16}$/)
      expect(buyer.isAuthenticated).toBe(false)
      expect(buyer.customerGroupIds).toEqual([])
      expect(buyer.priceKindId).toBe('kind-retail')
      expectGroupsNeverConsulted(harness)
    })

    it('keeps the closed anonymous assortment empty even when the channel carries its own scope', async () => {
      const harness = createHarness()

      const buyer = await resolveBuyerContext(
        harness.container,
        resolvedStore({ requireAuthentication: true, channelScope: { categoryIds: ['cat-1'] } }),
        null,
      )

      expect(buyer.assortmentScope).toEqual([])
      expectGroupsNeverConsulted(harness)
    })

    it('does not emit the empty assortment event for a closed anonymous buyer', async () => {
      const harness = createHarness()

      await resolveBuyerContext(harness.container, resolvedStore({ requireAuthentication: true }), null)

      expect(mockedEmit).not.toHaveBeenCalled()
    })

    it('resolves an authenticated buyer normally through customer_groups', async () => {
      const harness = createHarness({
        users: [user('cu-1', 'person-1', null)],
        groupsByCustomer: { 'person-1': { groupIds: ['group-1'], scope: [{ categoryIds: ['cat-b2b'] }] } },
      })
      mockedAuth.mockResolvedValue(sessionFor('cu-1'))

      const buyer = await resolveBuyerContext(harness.container, resolvedStore({ requireAuthentication: true }), request())

      expect(buyer.isAuthenticated).toBe(true)
      expect(buyer.customerGroupIds).toEqual(['group-1'])
      expect(buyer.assortmentScope).toEqual([{ categoryIds: ['cat-b2b'] }])
      expect(harness.customerGroupsService.resolveGroups).toHaveBeenCalledTimes(1)
      expect(harness.customerGroupsService.resolveTerms).toHaveBeenCalledTimes(1)
      expect(harness.customerGroupsService.resolveAssortmentScope).toHaveBeenCalledTimes(1)
    })

    it('leaves anonymous resolution unchanged when the flag is off', async () => {
      const harness = createHarness({ defaultGroup: { groupIds: ['group-default'], scope: null } })

      const buyer = await resolveBuyerContext(harness.container, resolvedStore({ requireAuthentication: false }), null)

      expect(buyer.assortmentScope).toBeNull()
      expect(buyer.customerGroupIds).toEqual(['group-default'])
      expect(harness.customerGroupsService.resolveGroups).toHaveBeenCalledTimes(1)
      expect(harness.customerGroupsService.resolveTerms).toHaveBeenCalledTimes(1)
      expect(harness.customerGroupsService.resolveAssortmentScope).toHaveBeenCalledTimes(1)
    })
  })
})

describe('composeStoreContext digest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  async function buyerFor(harness: ReturnType<typeof createHarness>, customerUserId: string) {
    mockedAuth.mockResolvedValue(sessionFor(customerUserId))
    return resolveBuyerContext(harness.container, resolvedStore(), request())
  }

  it('gives buyers in different groups different digests', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', null), user('cu-2', 'person-2', null)],
      groupsByCustomer: { 'person-1': { groupIds: ['group-a'] }, 'person-2': { groupIds: ['group-b'] } },
    })
    const first = composeStoreContext(resolvedStore(), await buyerFor(harness, 'cu-1'))
    const second = composeStoreContext(resolvedStore(), await buyerFor(harness, 'cu-2'))

    expect(first.buyer.priceScopeKey).not.toBe(second.buyer.priceScopeKey)
    expect(first.digest).not.toBe(second.digest)
  })

  it('gives the same buyer different digests in different locales', async () => {
    const harness = createHarness({ users: [user('cu-1', 'person-1', null)] })
    const buyer = await buyerFor(harness, 'cu-1')

    const english = composeStoreContext(resolvedStore({ effectiveLocale: 'en' }), buyer)
    const german = composeStoreContext(resolvedStore({ effectiveLocale: 'de' }), buyer)

    expect(english.digest).not.toBe(german.digest)
    expect(english.digest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('collapses buyers sharing groups without contract rows onto one price scope and digest', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', 'company-1'), user('cu-2', 'person-2', 'company-2')],
      groupsByCustomer: {
        'person-1': { groupIds: ['group-a', 'group-b'] },
        'person-2': { groupIds: ['group-b', 'group-a'] },
      },
    })
    const first = composeStoreContext(resolvedStore(), await buyerFor(harness, 'cu-1'))
    const second = composeStoreContext(resolvedStore(), await buyerFor(harness, 'cu-2'))

    expect(first.buyer.customerOverlayId).toBeNull()
    expect(first.buyer.priceScopeKey).toBe(second.buyer.priceScopeKey)
    expect(first.digest).toBe(second.digest)
  })

  it('keeps a contracted buyer off the shared group entry', async () => {
    const harness = createHarness({
      users: [user('cu-1', 'person-1', null), user('cu-2', 'person-2', null)],
      groupsByCustomer: { 'person-1': { groupIds: ['group-a'] }, 'person-2': { groupIds: ['group-a'] } },
      overlayCustomerIds: ['person-2'],
    })
    const first = composeStoreContext(resolvedStore(), await buyerFor(harness, 'cu-1'))
    const second = composeStoreContext(resolvedStore(), await buyerFor(harness, 'cu-2'))

    expect(first.buyer.priceScopeKey).toBe(second.buyer.priceScopeKey)
    expect(first.digest).not.toBe(second.digest)
  })

  it('separates the closed-channel anonymous digest from the open-channel anonymous one', async () => {
    const openStore = resolvedStore({ requireAuthentication: false })
    const closedStore = resolvedStore({ requireAuthentication: true })
    const openHarness = createHarness({ defaultGroup: { groupIds: ['group-default'], scope: null } })
    const closedHarness = createHarness({ defaultGroup: { groupIds: ['group-default'], scope: null } })

    const open = composeStoreContext(openStore, await resolveBuyerContext(openHarness.container, openStore, null))
    const closed = composeStoreContext(closedStore, await resolveBuyerContext(closedHarness.container, closedStore, null))

    expect(closed.buyer.assortmentScopeHash).not.toBe(open.buyer.assortmentScopeHash)
    expect(closed.digest).not.toBe(open.digest)
  })

  it('projects the channel without the internal assortment scope', () => {
    const buyer = {
      customerUserId: null,
      customerId: null,
      companyId: null,
      customerIds: [],
      customerGroupIds: [],
      isAuthenticated: false,
      taxMode: 'gross' as const,
      priceKindId: null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: null,
      assortmentScope: null,
      assortmentScopeHash: '0000000000000000',
      priceScopeKey: '0000000000000000',
      customerOverlayId: null,
    }
    const context = composeStoreContext(resolvedStore({ channelScope: { categoryIds: ['cat-1'] } }), buyer)

    expect(context.channel).toEqual({
      channelBindingId: 'channel-binding-1',
      salesChannelId: 'sales-channel-1',
      priceKindId: 'kind-retail',
      priceSortFallback: 'approximate',
    })
    expect(context.tenantId).toBe(TENANT_ID)
    expect(context.currencyCode).toBe('EUR')
  })
})
