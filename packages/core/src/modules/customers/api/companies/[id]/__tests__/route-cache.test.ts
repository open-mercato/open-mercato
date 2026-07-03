/** @jest-environment node */

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

function makeRequest() {
  return new Request(`http://localhost/api/customers/companies/${COMPANY_ID}`)
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
})
