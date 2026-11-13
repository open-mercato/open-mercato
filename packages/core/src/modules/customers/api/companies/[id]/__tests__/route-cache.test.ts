/** @jest-environment node */

import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'

const mockRunWithCacheTenant = jest.fn(
  async <T>(_tenant: string | null, fn: () => Promise<T> | T) => fn(),
)
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (...args: unknown[]) =>
    (mockRunWithCacheTenant as unknown as (...a: unknown[]) => unknown)(...args),
}))

let cacheEnabled = false
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
}
jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    isCrudCacheEnabled: () => cacheEnabled,
    resolveCrudCache: () => (cacheEnabled ? mockCache : null),
  }
})

const mockGetAuthFromRequest = jest.fn()
const mockGetGrantedFeatures = jest.fn(async () => ['customers.*', 'example.*'])
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockResolveCustomerInteractionFeatureFlags = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockResolveCompanyCustomFieldRouting = jest.fn()
const mockMergeCompanyCustomFieldValues = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  })),
}

const mockBaseCurrencyService = {
  resolveBaseCurrency: jest.fn(async () => ({ status: 'missing' })),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { getGrantedFeatures: mockGetGrantedFeatures }
    if (token === 'baseCurrencyService') return mockBaseCurrencyService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScopeForRequest(args)),
}))

jest.mock('../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn((...args: unknown[]) => mockResolveCustomerInteractionFeatureFlags(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

jest.mock('../../../../lib/customFieldRouting', () => ({
  resolveCompanyCustomFieldRouting: jest.fn((...args: unknown[]) => mockResolveCompanyCustomFieldRouting(...args)),
  mergeCompanyCustomFieldValues: jest.fn((...args: unknown[]) => mockMergeCompanyCustomFieldValues(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customer_entity',
      customer_company_profile: 'customer_company_profile',
    },
  },
}), { virtual: true })

const COMPANY_ID = '2408107d-0000-4000-8000-000000000000'

function buildCompany() {
  const createdAt = new Date('2026-04-10T08:00:00.000Z')
  return {
    id: COMPANY_ID,
    kind: 'company',
    deletedAt: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    companyProfile: null,
    displayName: 'Acme Corp',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    temperature: null,
    renewalQuarter: null,
    createdAt,
    updatedAt: createdAt,
  }
}

function makeRequest(search = '') {
  return new Request(`http://localhost/api/customers/companies/${COMPANY_ID}${search}`)
}

describe('GET /api/customers/companies/[id] — detail cache (#3664)', () => {
  beforeEach(() => {
    jest.resetModules()
    cacheEnabled = false
    mockRunWithCacheTenant.mockClear()
    mockCache.get.mockReset()
    mockCache.set.mockReset()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockResolveCustomerInteractionFeatureFlags.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockResolveCompanyCustomFieldRouting.mockReset()
    mockMergeCompanyCustomFieldValues.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockEm.findOne.mockReset()
    mockEm.find.mockReset()
    mockEm.count.mockReset()
    mockEm.count.mockResolvedValue(0)
    mockContainer.resolve.mockClear()
    mockBaseCurrencyService.resolveBaseCurrency.mockReset()
    mockBaseCurrencyService.resolveBaseCurrency.mockResolvedValue({ status: 'missing' })

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isApiKey: false,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      filterIds: ['org-1'],
      selectedId: 'org-1',
      tenantId: 'tenant-1',
    })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockResolveCompanyCustomFieldRouting.mockResolvedValue({})
    mockMergeCompanyCustomFieldValues.mockReturnValue({})
    mockEm.find.mockResolvedValue([])
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('does not touch the cache when the CRUD cache flag is off', async () => {
    cacheEnabled = false
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany()).mockResolvedValueOnce(null)

    const { GET } = await import('../route')
    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })

    expect(response.status).toBe(200)
    expect(mockCache.get).not.toHaveBeenCalled()
    expect(mockCache.set).not.toHaveBeenCalled()
    expect(mockRunWithCacheTenant).not.toHaveBeenCalled()
  })

  it('stores the detail payload with the reused collection tags on a cache miss', async () => {
    cacheEnabled = true
    mockCache.get.mockResolvedValue(null)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany()).mockResolvedValueOnce(null)

    const { GET } = await import('../route')
    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })

    expect(response.status).toBe(200)
    expect(mockCache.get).toHaveBeenCalledTimes(1)
    expect(mockCache.set).toHaveBeenCalledTimes(1)

    const lookupKey = mockCache.get.mock.calls[0][0] as string
    const [storedKey, , storeOptions] = mockCache.set.mock.calls[0] as [
      string,
      unknown,
      { ttl: number; tags: string[] },
    ]

    expect(storedKey).toBe(lookupKey)
    expect(lookupKey).toContain(`company:${COMPANY_ID}`)
    expect(lookupKey).toContain('tenant:tenant-1')
    expect(lookupKey).toContain('org:org-1')
    expect(lookupKey).toContain('selected:org-1')
    expect(lookupKey).toContain('filter:org-1')
    expect(lookupKey).toContain('super:0')
    expect(lookupKey).toContain('viewer:user-1')
    expect(lookupKey).toMatch(/^customers:companies:detail:v2\|/)
    expect(lookupKey).toContain('mode:legacy')

    expect(storeOptions.ttl).toBe(60_000)
    expect(storeOptions.tags).toEqual(
      expect.arrayContaining([
        'crud:customers.company:tenant:tenant-1:org:org-1:collection',
        'crud:customers.address:tenant:tenant-1:org:org-1:collection',
        'crud:customers.tag.assignment:tenant:tenant-1:org:org-1:collection',
        'crud:customers.label.assignment:tenant:tenant-1:org:org-1:collection',
        'crud:customers.person.company.link:tenant:tenant-1:org:org-1:collection',
        'crud:customers.interaction:tenant:tenant-1:org:org-1:collection',
        'crud:customers.activity:tenant:tenant-1:org:org-1:collection',
      ]),
    )
    expect(storeOptions.tags).toHaveLength(7)
  })

  it.each([false, true])('skips restricted related reads when unified interactions are %s', async (unified) => {
    mockGetGrantedFeatures.mockResolvedValueOnce(['customers.companies.view'])
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified })
    mockFindOneWithDecryption.mockReset().mockResolvedValueOnce({
      ...buildCompany(),
      nextInteractionAt: new Date('2026-01-01T00:00:00Z'),
      nextInteractionName: 'Scheduled follow-up',
      nextInteractionRefId: 'follow-up',
    }).mockResolvedValue(null)
    mockEm.count.mockResolvedValue(7)
    const { GET } = await import('../route')

    const response = await GET(makeRequest('?include=addresses,notes,activities,interactions,tasks,deals,people'), {
      params: { id: COMPANY_ID },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      company: { id: COMPANY_ID, nextInteractionAt: null, nextInteractionName: null, nextInteractionRefId: null },
      addresses: [], comments: [], activities: [], interactions: [], todos: [], deals: [],
      people: [], kpis: {},
      counts: { addresses: 0, comments: 0, activities: 0, interactions: 0, todos: 0, deals: 0 },
    })
    expect(body).not.toHaveProperty('plannedActivitiesPreview')
    expect(mockEm.count).not.toHaveBeenCalled()
    const relatedEntities = [
      'CustomerAddress', 'CustomerComment', 'CustomerActivity', 'CustomerInteraction',
      'CustomerTodoLink', 'CustomerDealCompanyLink', 'CustomerDealPersonLink',
    ]
    const loadedEntities = mockFindWithDecryption.mock.calls.map(([, entity]) => entity.name)
    expect(loadedEntities.filter((entity) => relatedEntities.includes(entity))).toEqual([])
  })

  it('does not reuse cached summaries after related-record permissions are revoked', async () => {
    cacheEnabled = true
    const stored = new Map<string, unknown>()
    mockCache.get.mockImplementation(async (key: string) => stored.get(key))
    mockCache.set.mockImplementation(async (key: string, payload: unknown) => stored.set(key, payload))
    mockFindOneWithDecryption.mockReset().mockResolvedValueOnce(buildCompany()).mockResolvedValue(null)
    const { GET } = await import('../route')

    const authorized = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toHaveProperty('plannedActivitiesPreview')

    mockGetGrantedFeatures.mockResolvedValueOnce(['customers.companies.view'])
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())
    mockEm.count.mockClear()

    const restricted = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(restricted.status).toBe(200)
    const body = await restricted.json()
    expect(body).not.toHaveProperty('plannedActivitiesPreview')
    expect(body.counts).toMatchObject({
      activities: 0, addresses: 0, comments: 0, deals: 0, interactions: 0, todos: 0,
    })
    expect(body.kpis).toEqual({})
    expect(body.counts.people).toBe(0)
    expect(mockEm.count).not.toHaveBeenCalled()
    expect(mockCache.get.mock.calls[0][0]).not.toBe(mockCache.get.mock.calls[1][0])
  })

  it('serves the cached payload and skips the detail sweeps on a cache hit', async () => {
    cacheEnabled = true
    const cachedPayload = { interactionMode: 'legacy', company: { id: COMPANY_ID, displayName: 'Cached Co' } }
    mockCache.get.mockResolvedValue(cachedPayload)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())

    const { GET } = await import('../route')
    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(cachedPayload)
    // The existence + org read-access check still runs (company findOne), but the
    // expensive enrichment sweeps and the cache write are skipped on a hit.
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockCache.set).not.toHaveBeenCalled()
  })

  // #8242 review: the base-currency fallback must not be baked into the cached payload,
  // otherwise a changed organization base currency stays stale for the cache TTL.
  it('re-resolves the base-currency fallback on every read instead of caching it', async () => {
    cacheEnabled = true
    const stored = new Map<string, unknown>()
    mockCache.get.mockImplementation(async (key: string) => stored.get(key))
    mockCache.set.mockImplementation(async (key: string, payload: unknown) => stored.set(key, payload))
    mockFindOneWithDecryption.mockReset().mockResolvedValueOnce(buildCompany()).mockResolvedValue(null)
    mockBaseCurrencyService.resolveBaseCurrency
      .mockResolvedValueOnce({ status: 'resolved', code: 'USD' })
      .mockResolvedValueOnce({ status: 'resolved', code: 'GBP' })
    const { GET } = await import('../route')

    const miss = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(miss.status).toBe(200)
    expect((await miss.json()).kpis.dealCurrency).toBe('USD')
    const storedPayload = mockCache.set.mock.calls[0][1] as { kpis: { dealCurrency: string | null } }
    expect(storedPayload.kpis.dealCurrency).toBeNull()

    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())
    const hit = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(hit.status).toBe(200)
    expect(mockCache.set).toHaveBeenCalledTimes(1)
    expect((await hit.json()).kpis.dealCurrency).toBe('GBP')
    expect(storedPayload.kpis.dealCurrency).toBeNull()
    expect(mockBaseCurrencyService.resolveBaseCurrency).toHaveBeenCalledTimes(2)
  })

  it('serves a cached deal currency without consulting the base currency', async () => {
    cacheEnabled = true
    const cachedPayload = {
      interactionMode: 'legacy',
      company: { id: COMPANY_ID, displayName: 'Cached Co' },
      kpis: { activeDealsCount: 1, activeDealsValue: 500, dealCurrency: 'EUR' },
    }
    mockCache.get.mockResolvedValue(cachedPayload)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())
    const { GET } = await import('../route')

    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })

    expect(response.status).toBe(200)
    expect((await response.json()).kpis.dealCurrency).toBe('EUR')
    expect(mockBaseCurrencyService.resolveBaseCurrency).not.toHaveBeenCalled()
  })

  it('applies the base-currency fallback to a cached won total with one lookup', async () => {
    cacheEnabled = true
    const cachedPayload = {
      interactionMode: 'legacy',
      company: { id: COMPANY_ID, displayName: 'Cached Co' },
      kpis: { activeDealsCount: 0, activeDealsValue: null, dealCurrency: null, ltvValue: 900, ltvCurrency: null },
    }
    mockCache.get.mockResolvedValue(cachedPayload)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())
    mockBaseCurrencyService.resolveBaseCurrency.mockResolvedValue({ status: 'resolved', code: 'USD' })
    const { GET } = await import('../route')

    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    const kpis = (await response.json()).kpis

    expect(kpis.dealCurrency).toBe('USD')
    expect(kpis.ltvCurrency).toBe('USD')
    expect(mockBaseCurrencyService.resolveBaseCurrency).toHaveBeenCalledTimes(1)
    expect(cachedPayload.kpis.ltvCurrency).toBeNull()
  })

  it('does not add a currency to a cached payload whose deal KPIs are hidden', async () => {
    cacheEnabled = true
    const cachedPayload = { interactionMode: 'legacy', company: { id: COMPANY_ID, displayName: 'Cached Co' }, kpis: {} }
    mockCache.get.mockResolvedValue(cachedPayload)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())
    const { GET } = await import('../route')

    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })

    expect((await response.json()).kpis).toEqual({})
    expect(mockBaseCurrencyService.resolveBaseCurrency).not.toHaveBeenCalled()
  })
})

describe('company detail contributed namespaces on base cache reads', () => {
  afterEach(() => registerResponseEnrichers([]))

  it('enriches cold/cache-hit reads freshly without storing contributor data', async () => {
    cacheEnabled = true
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-1'], selectedId: 'org-1', tenantId: 'tenant-1' })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockMergeCompanyCustomFieldValues.mockReturnValue({})
    mockFindWithDecryption.mockResolvedValue([])
    mockEm.find.mockResolvedValue([])
    mockCache.get.mockResolvedValue(null)
    mockCache.set.mockClear()
    let priority = 'high'
    const enrichOne = jest.fn(async (record: Record<string, unknown>) => ({ ...record, _example: { priority } }))
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.priority', targetEntity: 'customers.company', enrichOne }] }])
    mockFindOneWithDecryption.mockReset().mockResolvedValueOnce(buildCompany()).mockResolvedValueOnce(null)
    const { GET } = await import('../route')
    const cold = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(await cold.json()).toMatchObject({ _example: { priority: 'high' }, company: { _example: { priority: 'high' } } })
    const base = mockCache.set.mock.calls[0][1] as Record<string, unknown>
    expect(base).not.toHaveProperty('_example')
    expect(base.company).not.toHaveProperty('_example')
    priority = 'critical'
    mockCache.get.mockResolvedValue(base)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildCompany())
    const hit = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(await hit.json()).toMatchObject({ _example: { priority: 'critical' } })
    expect(base).not.toHaveProperty('_example')
    expect(enrichOne).toHaveBeenCalledTimes(2)
  })

  it('denies an out-of-scope organization before cache or enrichment', async () => {
    cacheEnabled = true
    mockCache.get.mockClear()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-other' })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-other'], allowedIds: ['org-other'], selectedId: 'org-other', tenantId: 'tenant-1' })
    mockFindOneWithDecryption.mockReset().mockResolvedValueOnce(buildCompany())
    const enrichOne = jest.fn(async (record: Record<string, unknown>) => ({ ...record, _example: { priority: 'high' } }))
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.priority', targetEntity: '*', enrichOne }] }])
    const { GET } = await import('../route')
    const response = await GET(makeRequest(), { params: { id: COMPANY_ID } })
    expect(response.status).toBe(404)
    expect(mockCache.get).not.toHaveBeenCalled()
    expect(enrichOne).not.toHaveBeenCalled()
  })
})
