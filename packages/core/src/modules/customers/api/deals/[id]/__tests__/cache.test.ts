/** @jest-environment node */

const dealId = '550e8400-e29b-41d4-a716-446655440000'
const tenantId = 'tenant-1'
const organizationId = 'org-1'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockDecryptEntitiesWithFallbackScope = jest.fn()
const mockUserHasAllFeatures = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
}

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'cache') return cache
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

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  decryptEntitiesWithFallbackScope: jest.fn((...args: unknown[]) => mockDecryptEntitiesWithFallbackScope(...args)),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string | null, fn: () => unknown) => fn()),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_deal: 'customer_deal',
    },
  },
}), { virtual: true })

const ORIGINAL_ENV = { ...process.env }

const makeDealRow = () => ({
  id: dealId,
  organizationId,
  tenantId,
  title: 'Expansion renewal',
  description: null,
  status: 'qualified',
  pipelineStage: null,
  pipelineId: null,
  pipelineStageId: null,
  valueAmount: '12000',
  valueCurrency: 'USD',
  probability: 65,
  expectedCloseAt: null,
  ownerUserId: null,
  source: 'Referral',
  closureOutcome: null,
  lossReasonId: null,
  lossNotes: null,
  createdAt: new Date('2026-04-10T08:00:00.000Z'),
  updatedAt: new Date('2026-04-14T16:30:00.000Z'),
  deletedAt: null,
})

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

const makeRequest = () => new Request(`http://localhost/api/customers/deals/${dealId}`)
const routeContext = { params: { id: dealId } }

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }

  mockGetAuthFromRequest.mockResolvedValue({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
    email: 'viewer@example.com',
    isApiKey: false,
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: organizationId,
    filterIds: [organizationId],
    allowedIds: [organizationId],
    tenantId,
  })
  mockUserHasAllFeatures.mockResolvedValue(true)
  mockLoadCustomFieldValues.mockResolvedValue({ [dealId]: {} })
  mockDecryptEntitiesWithFallbackScope.mockResolvedValue(undefined)
  mockFindWithDecryption.mockResolvedValue([])
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }, where: Record<string, unknown>) => {
    if (entity?.name === 'CustomerDeal') return makeDealRow()
    if (entity?.name === 'User') {
      if (where?.id === 'user-1') return { id: 'user-1', name: 'Viewer User', email: 'viewer@example.com' }
      return null
    }
    return null
  })
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('GET /api/customers/deals/[id] caching', () => {
  it('does not touch the cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()

    const response = await GET(makeRequest(), routeContext)

    expect(response.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(mockContainer.resolve).not.toHaveBeenCalledWith('cache')
  })

  it('stores the detail payload with the command-bus collection tags on a miss', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    const response = await GET(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deal.id).toBe(dealId)
    expect(body.viewer).toEqual({ userId: 'user-1', name: 'Viewer User', email: 'viewer@example.com' })

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)

    const [key, value, opts] = cache.set.mock.calls[0]
    expect(key).toBe(
      `customers:deal:detail:tenant=${tenantId}:org=${organizationId}:deal=${dealId}:scope=filter:${organizationId}:view=full:include=none`,
    )
    // The request-specific viewer block is never cached.
    expect(value).not.toHaveProperty('viewer')
    expect((value as { deal: { id: string } }).deal.id).toBe(dealId)
    expect(opts.ttl).toBe(60_000)
    expect(opts.tags).toEqual([
      `crud:customers.deal:tenant:${tenantId}:org:${organizationId}:collection`,
      `crud:customers.pipeline:tenant:${tenantId}:org:${organizationId}:collection`,
      `crud:customers.pipeline.stage:tenant:${tenantId}:org:${organizationId}:collection`,
      `crud:customers.dictionary.entry:tenant:${tenantId}:org:${organizationId}:collection`,
    ])
  })

  it('serves a cache hit without re-running the heavy sweeps and refreshes the viewer block', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    const cachedBody = {
      deal: { id: dealId, title: 'Cached deal', organizationId, tenantId },
      people: [{ id: 'p-1', label: 'Ada', subtitle: null, kind: 'person' }],
      companies: [],
      linkedPersonIds: ['p-1'],
      linkedCompanyIds: [],
      counts: { people: 1, companies: 0 },
      customFields: { priority: 'high' },
      pipelineStages: [],
      pipelineName: null,
      stageTransitions: [],
      owner: null,
    }
    cache.get.mockResolvedValue(cachedBody)

    const response = await GET(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deal).toEqual(cachedBody.deal)
    expect(body.people).toEqual(cachedBody.people)
    expect(body.customFields).toEqual({ priority: 'high' })
    // Viewer is always resolved fresh, never served from the cached value.
    expect(body.viewer).toEqual({ userId: 'user-1', name: 'Viewer User', email: 'viewer@example.com' })

    // The cache hit skips the association / custom-field / pipeline-stage / dictionary sweeps.
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockLoadCustomFieldValues).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('keys the cache by tenant, organization, deal, scope, view, and include axes', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    await GET(
      new Request(`http://localhost/api/customers/deals/${dealId}?include=stages&view=lite`),
      routeContext,
    )

    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key] = cache.set.mock.calls[0]
    expect(key).toBe(
      `customers:deal:detail:tenant=${tenantId}:org=${organizationId}:deal=${dealId}:scope=filter:${organizationId}:view=lite:include=stages`,
    )
  })

  it('partitions the cache key per RBAC scope', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'admin-1',
      tenantId,
      orgId: organizationId,
      email: 'admin@example.com',
      isApiKey: false,
      isSuperAdmin: true,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId,
    })
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    await GET(makeRequest(), routeContext)

    const [key] = cache.set.mock.calls[0]
    expect(key).toContain(':scope=super:')
  })

  it('falls back to a fresh read when the cache get throws', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockRejectedValue(new Error('cache backend down'))

    const response = await GET(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deal.id).toBe(dealId)
    // A read error must degrade to the DB sweeps, not a 500.
    expect(mockLoadCustomFieldValues).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
  })
})
