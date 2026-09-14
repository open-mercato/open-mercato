/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '11111111-1111-4111-8111-111111111112'
const organizationId = '22222222-2222-4222-8222-222222222222'
const otherOrganizationId = '22222222-2222-4222-8222-222222222223'
const thirdOrganizationId = '22222222-2222-4222-8222-222222222224'
const userId = '33333333-3333-4333-8333-333333333333'
const otherUserId = '33333333-3333-4333-8333-333333333334'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const otherPipelineId = '44444444-4444-4444-8444-444444444445'
const ownerUserId = '55555555-5555-4555-8555-555555555555'
const otherOwnerUserId = '55555555-5555-4555-8555-555555555556'
const personId = '66666666-6666-4666-8666-666666666666'
const otherPersonId = '66666666-6666-4666-8666-666666666667'
const companyId = '77777777-7777-4777-8777-777777777777'
const otherCompanyId = '77777777-7777-4777-8777-777777777778'

const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const resolveDealsOrganizationIdsMock = jest.fn()
const resolveOptionalBaseCurrencyCodeMock = jest.fn()
const executeMock = jest.fn()
const getRatesMock = jest.fn()
const runWithCacheTenantMock = jest.fn((_tenantId: string | null, operation: () => unknown) => operation())
const findMatchingEntityIdsBySearchTokensAcrossSourcesMock = jest.fn()
const fetchStuckDealIdsMock = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
}

const entityManager = {
  getConnection: () => ({ execute: executeMock }),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return entityManager
    if (name === 'cache') return cache
    if (name === 'exchangeRateService') return { getRates: getRatesMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => getAuthFromRequestMock(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => resolveOrganizationScopeForRequestMock(args)),
}))

jest.mock('../../../../lib/dealsOrganizationScope', () => ({
  resolveDealsOrganizationIds: jest.fn((args: unknown) => resolveDealsOrganizationIdsMock(args)),
}))

jest.mock('../../../../lib/optionalBaseCurrency', () => ({
  resolveOptionalBaseCurrencyCode: jest.fn((...args: unknown[]) => resolveOptionalBaseCurrencyCodeMock(...args)),
}))

jest.mock('../../../utils', () => ({
  findMatchingEntityIdsBySearchTokensAcrossSources: jest.fn((...args: unknown[]) => (
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock(...args)
  )),
}))

jest.mock('../../../../lib/stuckDeals', () => ({
  fetchStuckDealIds: jest.fn((...args: unknown[]) => fetchStuckDealIdsMock(...args)),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((tenant: string | null, operation: () => unknown) => (
    runWithCacheTenantMock(tenant, operation)
  )),
}))

const originalEnvironment = { ...process.env }

const aggregateRows = [
  {
    stage_id: '88888888-8888-4888-8888-888888888888',
    currency: 'USD',
    total: '1250',
    count: '2',
    open_count: '1',
  },
]

const cachedResponse = {
  baseCurrencyCode: 'USD',
  perStage: [
    {
      stageId: '88888888-8888-4888-8888-888888888888',
      count: 2,
      openCount: 1,
      totalInBaseCurrency: 1250,
      byCurrency: [{ currency: 'USD', total: 1250, count: 2 }],
      convertedAll: true,
      missingRateCurrencies: [],
    },
  ],
}

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

function makeScope(activeTenantId = tenantId, activeOrganizationId = organizationId) {
  return {
    selectedId: activeOrganizationId,
    filterIds: [activeOrganizationId],
    allowedIds: [activeOrganizationId],
    tenantId: activeTenantId,
  }
}

function makeAuth(activeTenantId = tenantId, activeUserId = userId) {
  return {
    sub: activeUserId,
    tenantId: activeTenantId,
    orgId: organizationId,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnvironment }
  getAuthFromRequestMock.mockResolvedValue(makeAuth())
  resolveOrganizationScopeForRequestMock.mockResolvedValue(makeScope())
  resolveDealsOrganizationIdsMock.mockResolvedValue([organizationId])
  resolveOptionalBaseCurrencyCodeMock.mockResolvedValue('USD')
  executeMock.mockResolvedValue(aggregateRows)
  getRatesMock.mockResolvedValue(new Map())
  cache.get.mockResolvedValue(null)
  cache.set.mockResolvedValue(undefined)
  findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValue([])
  fetchStuckDealIdsMock.mockResolvedValue([])
})

afterAll(() => {
  process.env = originalEnvironment
})

describe('GET /api/customers/deals/aggregate caching', () => {
  it('does not resolve or touch the cache when the CRUD cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()

    const response = await GET(new Request('http://localhost/api/customers/deals/aggregate'))

    expect(response.status).toBe(200)
    expect(container.resolve).not.toHaveBeenCalledWith('cache')
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('stores a miss for 30 seconds with every contributing deal collection tag', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    resolveDealsOrganizationIdsMock.mockResolvedValue([
      otherOrganizationId,
      organizationId,
      otherOrganizationId,
    ])
    const { GET } = await loadRoute()

    const response = await GET(new Request(
      `http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&status=open&status=won`,
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(cachedResponse)
    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(resolveOptionalBaseCurrencyCodeMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(runWithCacheTenantMock).toHaveBeenCalledTimes(2)
    expect(runWithCacheTenantMock).toHaveBeenNthCalledWith(1, tenantId, expect.any(Function))
    expect(runWithCacheTenantMock).toHaveBeenNthCalledWith(2, tenantId, expect.any(Function))

    const [key, value, options] = cache.set.mock.calls[0]
    expect(key).toMatch(/^customers:deal:aggregate:v1:[a-f0-9]{64}$/)
    expect(value).toEqual(cachedResponse)
    expect(options).toEqual({
      ttl: 30_000,
      tags: [
        `crud:customers.deal:tenant:${tenantId}:org:${organizationId}:collection`,
        `crud:customers.deal:tenant:${tenantId}:org:${otherOrganizationId}:collection`,
      ],
    })
  })

  it('returns a schema-valid hit before base-currency, SQL, and exchange-rate work', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    cache.get.mockResolvedValue(cachedResponse)
    const { GET } = await loadRoute()

    const response = await GET(new Request('http://localhost/api/customers/deals/aggregate'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(cachedResponse)
    expect(resolveOptionalBaseCurrencyCodeMock).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
    expect(getRatesMock).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('treats a malformed cached value as a miss and overwrites it', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    cache.get.mockResolvedValue({ baseCurrencyCode: 'USD', perStage: 'invalid' })
    const { GET } = await loadRoute()

    const response = await GET(new Request('http://localhost/api/customers/deals/aggregate'))

    expect(response.status).toBe(200)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(cache.set.mock.calls[0][1]).toEqual(cachedResponse)
  })

  it('fails open when cache reads or writes throw', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    cache.get.mockRejectedValueOnce(new Error('cache read failed'))
    cache.set.mockRejectedValueOnce(new Error('cache write failed'))
    const { GET } = await loadRoute()

    const response = await GET(new Request('http://localhost/api/customers/deals/aggregate'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(cachedResponse)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['empty search', 'search='],
    ['false isStuck', 'isStuck=false'],
  ])('bypasses cache reads and writes when %s is present', async (_label, query) => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()

    const response = await GET(new Request(`http://localhost/api/customers/deals/aggregate?${query}`))

    expect(response.status).toBe(200)
    expect(container.resolve).not.toHaveBeenCalledWith('cache')
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes organization and filter sets without changing the currency-scope organization', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    resolveDealsOrganizationIdsMock
      .mockResolvedValueOnce([organizationId, thirdOrganizationId, otherOrganizationId, thirdOrganizationId])
      .mockResolvedValueOnce([organizationId, otherOrganizationId, thirdOrganizationId])
    const { GET } = await loadRoute()
    const firstQuery = [
      `pipelineId=${pipelineId}`,
      'status=won',
      'status=open',
      'status=won',
      `ownerUserId=${otherOwnerUserId}`,
      `ownerUserId=${ownerUserId}`,
      `personId=${otherPersonId}`,
      `personId=${personId}`,
      `companyId=${otherCompanyId}`,
      `companyId=${companyId}`,
    ].join('&')
    const secondQuery = [
      `pipelineId=${pipelineId}`,
      'status=open',
      'status=won',
      `ownerUserId=${ownerUserId}`,
      `ownerUserId=${otherOwnerUserId}`,
      `personId=${personId}`,
      `personId=${otherPersonId}`,
      `companyId=${companyId}`,
      `companyId=${otherCompanyId}`,
    ].join('&')

    await GET(new Request(`http://localhost/api/customers/deals/aggregate?${firstQuery}`))
    await GET(new Request(`http://localhost/api/customers/deals/aggregate?${secondQuery}`))

    expect(cache.set).toHaveBeenCalledTimes(2)
    expect(cache.set.mock.calls[0][0]).toBe(cache.set.mock.calls[1][0])
    expect(cache.set.mock.calls[0][2].tags).toEqual(cache.set.mock.calls[1][2].tags)
  })

  it('partitions every tenant, scope, and aggregate-filter input while omitting caller identity', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()

    const readKey = async (query = '', options?: {
      activeTenantId?: string
      activeUserId?: string
      organizationIds?: string[]
    }) => {
      const activeTenantId = options?.activeTenantId ?? tenantId
      getAuthFromRequestMock.mockResolvedValueOnce(makeAuth(activeTenantId, options?.activeUserId ?? userId))
      resolveOrganizationScopeForRequestMock.mockResolvedValueOnce(makeScope(activeTenantId))
      resolveDealsOrganizationIdsMock.mockResolvedValueOnce(options?.organizationIds ?? [organizationId])
      await GET(new Request(`http://localhost/api/customers/deals/aggregate${query ? `?${query}` : ''}`))
      return cache.set.mock.calls.at(-1)?.[0] as string
    }

    const baselineKey = await readKey()
    const sameScopeOtherUserKey = await readKey('', { activeUserId: otherUserId })
    const variantKeys = [
      await readKey('', { activeTenantId: otherTenantId }),
      await readKey('', { organizationIds: [otherOrganizationId, organizationId] }),
      await readKey('', { organizationIds: [organizationId, otherOrganizationId] }),
      await readKey(`pipelineId=${otherPipelineId}`),
      await readKey('status=won'),
      await readKey(`ownerUserId=${otherOwnerUserId}`),
      await readKey(`personId=${otherPersonId}`),
      await readKey(`companyId=${otherCompanyId}`),
      await readKey('expectedCloseAtFrom=2026-01-01'),
      await readKey('expectedCloseAtTo=2026-12-31'),
      await readKey('isOverdue=true'),
    ]

    expect(sameScopeOtherUserKey).toBe(baselineKey)
    expect(new Set(variantKeys).size).toBe(variantKeys.length)
    expect(variantKeys).not.toContain(baselineKey)
  })
})
