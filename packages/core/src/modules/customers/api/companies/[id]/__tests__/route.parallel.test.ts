/** @jest-environment node */

// Regression coverage for issue #3203: the company detail route must dispatch its
// independent enrichment reads in parallel instead of awaiting them one after
// another. The test makes findWithDecryption hang until two calls are in flight,
// which can only resolve if the route started them concurrently.

const mockGetAuthFromRequest = jest.fn()
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
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'queryEngine') return { query: jest.fn(async () => ({ items: [] })) }
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

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn(() => true),
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

const COMPANY_ID = '2408107d-0000-4000-8000-000000000020'

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

describe('GET /api/customers/companies/[id] — parallel enrichment (issue #3203)', () => {
  beforeEach(() => {
    jest.resetModules()
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

    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isApiKey: false })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-1'], selectedId: 'org-1', tenantId: 'tenant-1' })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockResolveCompanyCustomFieldRouting.mockResolvedValue(new Map())
    mockMergeCompanyCustomFieldValues.mockReturnValue({})
    mockFindOneWithDecryption
      .mockResolvedValueOnce(buildCompany())
      .mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('dispatches the independent tag/label/interaction reads concurrently', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })

    mockFindWithDecryption.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (maxInFlight >= 2) releaseGate()
      await gate
      inFlight -= 1
      return []
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request(`http://localhost/api/customers/companies/${COMPANY_ID}?include=comments,interactions`),
      { params: { id: COMPANY_ID } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.company.id).toBe(COMPANY_ID)
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
  })
})
