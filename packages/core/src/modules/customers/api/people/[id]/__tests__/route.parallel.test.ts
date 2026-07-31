/** @jest-environment node */

// Regression coverage for issue #3203: the people detail route must dispatch its
// independent enrichment reads in parallel instead of awaiting them one after
// another. The test makes findWithDecryption hang until all expected calls are
// in flight, which can only resolve if the route started them concurrently.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockResolveCustomerInteractionFeatureFlags = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockResolvePersonCustomFieldRouting = jest.fn()
const mockMergePersonCustomFieldValues = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockLoadPersonCompanyLinks = jest.fn()

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
  resolvePersonCustomFieldRouting: jest.fn((...args: unknown[]) => mockResolvePersonCustomFieldRouting(...args)),
  mergePersonCustomFieldValues: jest.fn((...args: unknown[]) => mockMergePersonCustomFieldValues(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
}))

jest.mock('../../../../lib/personCompanies', () => ({
  loadPersonCompanyLinks: jest.fn((...args: unknown[]) => mockLoadPersonCompanyLinks(...args)),
  summarizePersonCompanies: jest.fn(() => []),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customer_entity',
      customer_person_profile: 'customer_person_profile',
    },
  },
}), { virtual: true })

const PERSON_ID = '2408107d-0000-4000-8000-000000000010'

function buildPerson() {
  const createdAt = new Date('2026-04-10T08:00:00.000Z')
  return {
    id: PERSON_ID,
    kind: 'person',
    deletedAt: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    displayName: 'Ada Lovelace',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    temperature: null,
    renewalQuarter: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('GET /api/customers/people/[id] — parallel enrichment (issue #3203)', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockResolveCustomerInteractionFeatureFlags.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockResolvePersonCustomFieldRouting.mockReset()
    mockMergePersonCustomFieldValues.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockLoadPersonCompanyLinks.mockReset()
    mockEm.findOne.mockReset()
    mockEm.find.mockReset()
    mockEm.count.mockReset()
    mockEm.count.mockResolvedValue(0)
    mockContainer.resolve.mockClear()

    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isApiKey: false })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-1'], selectedId: 'org-1', tenantId: 'tenant-1' })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockResolvePersonCustomFieldRouting.mockResolvedValue(new Map())
    mockMergePersonCustomFieldValues.mockReturnValue({})
    mockLoadPersonCompanyLinks.mockResolvedValue([])
    mockFindOneWithDecryption
      .mockResolvedValueOnce(buildPerson())
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

    // The first batch of independent reads (tags, labels, and — with the include
    // flags below — comments + canonical interactions) all run through
    // findWithDecryption. Hold the first few open simultaneously: if the route
    // awaited them serially, only one would ever be in flight at a time and the
    // gate (released once two are concurrent) would never trip, hanging the test.
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
      new Request(`http://localhost/api/customers/people/${PERSON_ID}?include=comments,interactions`),
      { params: { id: PERSON_ID } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.person.id).toBe(PERSON_ID)
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
  })
})
