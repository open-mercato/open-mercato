/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockUserHasAllFeatures = jest.fn()

const mockEm = {
  count: jest.fn(),
  findOne: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
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

describe('GET /api/customers/deals/[id]/stats', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockUserHasAllFeatures.mockReset()
    mockEm.count.mockReset()
    mockEm.findOne.mockReset()
    mockContainer.resolve.mockClear()

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
