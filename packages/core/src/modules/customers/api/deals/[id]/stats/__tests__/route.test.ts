/** @jest-environment node */

import { getCurrentCacheTenant } from '@open-mercato/cache'

const originalCacheFlag = process.env.ENABLE_CRUD_API_CACHE
const dealId = '550e8400-e29b-41d4-a716-446655440000'
const closedDeal = {
  id: dealId,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  closureOutcome: 'won',
  valueAmount: '12000',
  valueCurrency: 'USD',
  createdAt: new Date('2026-04-01T08:00:00.000Z'),
  updatedAt: new Date('2026-04-14T16:30:00.000Z'),
}
const organizationScope = {
  filterIds: ['org-1', 'org-2'],
  allowedIds: ['org-1', 'org-2'],
  selectedId: 'org-1',
  tenantId: 'tenant-1',
}

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockCache = { get: jest.fn(), set: jest.fn() }

const mockEm = {
  count: jest.fn(),
  findOne: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'cache') return mockCache
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

async function readStats(id = dealId) {
  const { GET } = await import('../route')
  return GET(new Request(`http://localhost/api/customers/deals/${id}/stats`), { params: { id } })
}

describe('GET /api/customers/deals/[id]/stats', () => {
  beforeEach(() => {
    process.env.ENABLE_CRUD_API_CACHE = 'false'
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockUserHasAllFeatures.mockReset()
    mockEm.count.mockReset()
    mockEm.findOne.mockReset()
    mockContainer.resolve.mockClear()
    mockCache.get.mockReset()
    mockCache.set.mockReset()

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
    mockUserHasAllFeatures.mockResolvedValue(true)
  })

  afterEach(() => {
    if (originalCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = originalCacheFlag
    jest.useRealTimers()
  })

  it('skips cache resolution and work when the flag is off', async () => {
    mockFindOneWithDecryption.mockResolvedValue(closedDeal)
    mockEm.count.mockResolvedValue(1)

    expect((await readStats()).status).toBe(200)
    expect(mockContainer.resolve).not.toHaveBeenCalledWith('cache')
    expect(mockCache.get).not.toHaveBeenCalled()
    expect(mockCache.set).not.toHaveBeenCalled()
    expect(mockEm.count).toHaveBeenCalledTimes(2)
  })

  describe('with the CRUD cache enabled', () => {
    beforeEach(() => {
      process.env.ENABLE_CRUD_API_CACHE = 'true'
      mockFindOneWithDecryption.mockResolvedValue(closedDeal)
      mockEm.count.mockResolvedValue(1)
      mockResolveOrganizationScopeForRequest.mockResolvedValue(organizationScope)
      jest.useFakeTimers({ now: new Date(2026, 3, 14, 12) })
    })

    it('stores the payload in tenant context and skips both counts on an authorized hit', async () => {
      const readTenants: Array<string | null> = []
      const writeTenants: Array<string | null> = []
      mockCache.get.mockImplementation(async () => {
        readTenants.push(getCurrentCacheTenant())
        return mockCache.set.mock.calls.at(-1)?.[1]
      })
      mockCache.set.mockImplementation(async () => {
        writeTenants.push(getCurrentCacheTenant())
      })

      const payload = await (await readStats()).json()
      const [key] = mockCache.get.mock.calls[0]
      expect(mockCache.set).toHaveBeenCalledWith(key, payload, {
        ttl: 60_000,
        tags: [
          'crud:customers.deal:tenant:tenant-1:org:org-1:collection',
          'crud:customers.pipeline:tenant:tenant-1:org:org-1:collection',
          'crud:dictionaries.entry:tenant:tenant-1:org:org-1:collection',
        ],
      })
      mockResolveOrganizationScopeForRequest.mockResolvedValue({
        ...organizationScope,
        filterIds: ['org-2', 'org-1'],
        allowedIds: ['org-2', 'org-1'],
      })

      expect(await (await readStats()).json()).toEqual(payload)
      expect(mockCache.get).toHaveBeenLastCalledWith(key)
      expect(mockCache.set).toHaveBeenCalledTimes(1)
      expect(readTenants).toEqual(['tenant-1', 'tenant-1'])
      expect(writeTenants).toEqual(['tenant-1'])
      expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(2)
      expect(mockEm.count).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['tenant', { tenantId: 'tenant-2' }, {}, new Date(2026, 3, 14, 12)],
      ['organization', { organizationId: 'org-2' }, {}, new Date(2026, 3, 14, 12)],
      ['deal', { id: '550e8400-e29b-41d4-a716-446655440001' }, {}, new Date(2026, 3, 14, 12)],
      ['RBAC scope', {}, { filterIds: ['org-1'] }, new Date(2026, 3, 14, 12)],
      ['week', {}, {}, new Date(2026, 3, 20, 12)],
    ] satisfies [string, Partial<typeof closedDeal>, Partial<typeof organizationScope>, Date][])(
      'changes the cache key across a different %s',
      async (_axis, dealChanges, scopeChanges, nextTime) => {
        expect((await readStats()).status).toBe(200)
        const nextDeal = { ...closedDeal, ...dealChanges }
        mockFindOneWithDecryption.mockResolvedValue(nextDeal)
        mockResolveOrganizationScopeForRequest.mockResolvedValue({ ...organizationScope, ...scopeChanges })
        jest.setSystemTime(nextTime)

        expect((await readStats(nextDeal.id)).status).toBe(200)
        expect(mockCache.get.mock.calls[1][0]).not.toBe(mockCache.get.mock.calls[0][0])
      },
    )

    it('changes the cache key at a quarter boundary within the same week', async () => {
      jest.setSystemTime(new Date(2026, 2, 31, 23, 59))
      expect((await readStats()).status).toBe(200)
      jest.setSystemTime(new Date(2026, 3, 1, 0, 0))
      expect((await readStats()).status).toBe(200)

      expect(mockCache.get.mock.calls[1][0]).not.toBe(mockCache.get.mock.calls[0][0])
    })

    it('checks current organization access and closure before looking up a warm entry', async () => {
      expect((await readStats()).status).toBe(200)
      mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({ ...organizationScope, filterIds: [] })

      expect((await readStats()).status).toBe(404)
      mockFindOneWithDecryption.mockResolvedValueOnce({ ...closedDeal, closureOutcome: null })
      expect((await readStats()).status).toBe(400)
      expect(mockCache.get).toHaveBeenCalledTimes(1)
      expect(mockCache.set).toHaveBeenCalledTimes(1)
    })

    it('uses the database after a cache read or write failure or an invalid cached payload', async () => {
      mockCache.get.mockRejectedValueOnce(new Error('cache read failed')).mockResolvedValueOnce({ invalid: true })
      mockCache.set.mockRejectedValueOnce(new Error('cache write failed'))

      for (const expected of [1, 2]) {
        mockEm.count.mockResolvedValue(expected)
        const response = await readStats()
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ dealsClosedThisPeriod: expected })
      }
      expect(mockEm.count).toHaveBeenCalledTimes(4)
    })
  })

  it('returns DEAL_NOT_CLOSED when the deal has no closure outcome', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      closureOutcome: null,
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-14T16:30:00.000Z'),
      deletedAt: null,
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/deals/550e8400-e29b-41d4-a716-446655440000/stats'),
      { params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'Deal is not closed',
      code: 'DEAL_NOT_CLOSED',
    })
  })

  it('returns weekly closure counts, sales cycle, and quarter rank for a won deal', async () => {
    mockFindOneWithDecryption
      .mockResolvedValueOnce({
        id: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        pipelineId: '550e8400-e29b-41d4-a716-446655440010',
        valueAmount: '12000',
        valueCurrency: 'USD',
        closureOutcome: 'won',
        lossReasonId: null,
        createdAt: new Date('2026-04-01T08:00:00.000Z'),
        updatedAt: new Date('2026-04-14T16:30:00.000Z'),
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: '550e8400-e29b-41d4-a716-446655440010',
        name: 'Enterprise pipeline',
      })

    mockEm.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/deals/550e8400-e29b-41d4-a716-446655440000/stats'),
      { params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      dealValue: 12000,
      dealValueExact: '12000',
      dealCurrency: 'USD',
      closureOutcome: 'won',
      closedAt: '2026-04-14T16:30:00.000Z',
      pipelineName: 'Enterprise pipeline',
      dealsClosedThisPeriod: 4,
      salesCycleDays: 13,
      dealRankInQuarter: 3,
      lossReason: null,
    })
  })

  it('returns the loss reason label for a lost deal', async () => {
    mockFindOneWithDecryption
      .mockResolvedValueOnce({
        id: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        pipelineId: '550e8400-e29b-41d4-a716-446655440010',
        valueAmount: '9000',
        valueCurrency: 'EUR',
        closureOutcome: 'lost',
        lossReasonId: 'loss-reason-1',
        createdAt: new Date('2026-04-05T10:00:00.000Z'),
        updatedAt: new Date('2026-04-12T08:00:00.000Z'),
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: '550e8400-e29b-41d4-a716-446655440010',
        name: 'Mid-market pipeline',
      })
      .mockResolvedValueOnce({
        id: 'loss-reason-1',
        label: 'Pricing',
        value: 'Pricing',
        dictionary: {
          key: 'sales.deal_loss_reason',
        },
      })

    mockEm.count.mockResolvedValueOnce(2)

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/deals/550e8400-e29b-41d4-a716-446655440000/stats'),
      { params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      dealValue: 9000,
      dealValueExact: '9000',
      dealCurrency: 'EUR',
      closureOutcome: 'lost',
      closedAt: '2026-04-12T08:00:00.000Z',
      pipelineName: 'Mid-market pipeline',
      dealsClosedThisPeriod: 2,
      salesCycleDays: 6,
      dealRankInQuarter: null,
      lossReason: 'Pricing',
    })
  })
})
