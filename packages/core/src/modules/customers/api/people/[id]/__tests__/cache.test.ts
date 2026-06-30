/** @jest-environment node */

// Regression coverage for issue #3663: the people detail route must add a gated
// get-then-set cache that (a) is inert when ENABLE_CRUD_API_CACHE is off,
// (b) keys on tenant/org/personId + effective RBAC scope and stores the payload
// tagged with the reused customers.* collection tags, and (c) serves a hit
// without running the expensive decryption sweeps.

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

const cache = {
  get: jest.fn(),
  set: jest.fn(),
} as { get: jest.Mock; set: jest.Mock }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'cache') return cache
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

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const PERSON_ID = '2408107d-0000-4000-8000-000000000010'

function buildPerson() {
  const createdAt = new Date('2026-04-10T08:00:00.000Z')
  return {
    id: PERSON_ID,
    kind: 'person',
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
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

const ORIGINAL_ENV = { ...process.env }

const makeRequest = (search = '') =>
  new Request(`http://localhost/api/customers/people/${PERSON_ID}${search}`)

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

describe('GET /api/customers/people/[id] — caching (issue #3663)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }

    mockEm.count.mockResolvedValue(0)
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, isApiKey: false })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: [ORG_ID], selectedId: ORG_ID, tenantId: TENANT_ID })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockResolvePersonCustomFieldRouting.mockResolvedValue(new Map())
    mockMergePersonCustomFieldValues.mockReturnValue({})
    mockLoadPersonCompanyLinks.mockResolvedValue([])
    mockFindOneWithDecryption.mockResolvedValueOnce(buildPerson()).mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('does not touch the cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()

    const res = await GET(makeRequest(), { params: { id: PERSON_ID } })

    expect(res.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).toHaveBeenCalled()
  })

  it('runs get-then-set with the scoped key and reused collection tags on a miss', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    cache.get.mockResolvedValue(null)
    const { GET } = await loadRoute()

    const res = await GET(makeRequest('?include=comments'), { params: { id: PERSON_ID } })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { person: { id: string } }
    expect(body.person.id).toBe(PERSON_ID)

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)

    const [getKey] = cache.get.mock.calls[0]
    expect(getKey).toBe(
      `customers:person-detail:${PERSON_ID}:tenant=${TENANT_ID}:org=${ORG_ID}:caller=${USER_ID}:selOrg=${ORG_ID}:scope=${ORG_ID}:mode=legacy:include=comments`,
    )

    const [setKey, setValue, setOpts] = cache.set.mock.calls[0]
    expect(setKey).toBe(getKey)
    expect((setValue as { person: { id: string } }).person.id).toBe(PERSON_ID)
    expect(setOpts.ttl).toBe(60_000)
    expect(setOpts.tags).toEqual([
      `crud:customers.person:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
      `crud:customers.address:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
      `crud:customers.tagAssignment:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
      `crud:customers.labelAssignment:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
      `crud:customers.personCompanyLink:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
      `crud:customers.interaction:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
      `crud:customers.activity:tenant:${TENANT_ID}:org:${ORG_ID}:collection`,
    ])
  })

  it('keys the cache by the effective RBAC caller so visibility never leaks', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    cache.get.mockResolvedValue(null)
    mockGetAuthFromRequest.mockReset()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'api_key:abc', tenantId: TENANT_ID, orgId: ORG_ID, isApiKey: true })
    const { GET } = await loadRoute()

    await GET(makeRequest(), { params: { id: PERSON_ID } })

    const [setKey] = cache.set.mock.calls[0]
    expect(setKey).toContain('caller=api_key:abc')
    expect(setKey).toContain('include=none')
  })

  it('serves a cache hit without running the decryption sweeps', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const cachedPayload = { interactionMode: 'legacy', person: { id: PERSON_ID, displayName: 'Cached' } }
    cache.get.mockResolvedValue(cachedPayload)
    const { GET } = await loadRoute()

    const res = await GET(makeRequest('?include=comments'), { params: { id: PERSON_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(cachedPayload)
    expect(cache.set).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockLoadCustomFieldValues).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  })
})
