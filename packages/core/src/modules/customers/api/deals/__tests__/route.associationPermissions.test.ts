/** @jest-environment node */

import { GET } from '../route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const firstOrganizationId = '22222222-2222-4222-8222-222222222222'
const secondOrganizationId = '33333333-3333-4333-8333-333333333333'
const userId = 'user-1'

const fixtures = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    organizationId: firstOrganizationId,
    title: 'First Deal',
    person: { id: 'person-1', displayName: 'First Contact' },
    company: { id: 'company-1', displayName: 'First Company' },
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: secondOrganizationId,
    title: 'Second Deal',
    person: { id: 'person-2', displayName: 'Second Contact' },
    company: { id: 'company-2', displayName: 'Second Company' },
  },
]

const mockQuery = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockCacheStore = new Map<string, unknown>()
const mockCache = {
  get: jest.fn(async (key: string) => mockCacheStore.get(key) ?? null),
  set: jest.fn(async (key: string, value: unknown) => {
    mockCacheStore.set(key, structuredClone(value))
  }),
}

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, run: () => Promise<unknown>) => run(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: userId, tenantId, orgId: firstOrganizationId, roles: [] }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({
    tenantId,
    selectedId: null,
    filterIds: [firstOrganizationId, secondOrganizationId],
    allowedIds: [firstOrganizationId, secondOrganizationId],
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      const services: Record<string, unknown> = {
        em: {},
        rbacService: { userHasAllFeatures: mockUserHasAllFeatures },
        queryEngine: { query: mockQuery },
        cache: mockCache,
      }
      return services[token]
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/custom-fields'),
  loadCustomFieldDefinitionIndex: async () => new Map(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const listUrl = 'https://example.test/api/customers/deals'
const noAssociations = { people: [], personIds: [], companies: [], companyIds: [] }

describe('deal list association permissions', () => {
  const previousCacheFlag = process.env.ENABLE_CRUD_API_CACHE

  beforeAll(() => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
  })

  afterAll(() => {
    if (previousCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCacheFlag
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockCacheStore.clear()
    mockQuery.mockResolvedValue({
      items: fixtures.map(({ id, organizationId, title }) => ({
        id,
        title,
        organization_id: organizationId,
        tenant_id: tenantId,
      })),
      total: fixtures.length,
    })
    mockUserHasAllFeatures.mockImplementation(async (
      _userId: string,
      features: string[],
      scope: { organizationId: string },
    ) => features.every((feature) => {
      if (feature === 'customers.people.view') return scope.organizationId === firstOrganizationId
      if (feature === 'customers.companies.view') return scope.organizationId === secondOrganizationId
      return false
    }))
    mockFindWithDecryption.mockImplementation(async (
      _entityManager: unknown,
      _entity: unknown,
      filter: { deal: { id: { $in: string[] }; tenantId: string; organizationId: string } },
      options: { populate: ['person' | 'company'] },
    ) => fixtures
      .filter((fixture) => filter.deal.id.$in.includes(fixture.id)
        && filter.deal.tenantId === tenantId
        && filter.deal.organizationId === fixture.organizationId)
      .map((fixture) => {
        const association = options.populate[0]
        return {
          deal: { id: fixture.id },
          [association]: {
            ...fixture[association],
            tenantId,
            organizationId: fixture.organizationId,
          },
        }
      }))
  })

  it('applies independent grants in each returned deal’s organization', async () => {
    const response = await GET(new Request(listUrl))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 2,
      items: [
        {
          ...noAssociations,
          id: fixtures[0].id,
          people: [{ id: 'person-1', label: 'First Contact' }],
          personIds: ['person-1'],
        },
        {
          ...noAssociations,
          id: fixtures[1].id,
          companies: [{ id: 'company-2', label: 'Second Company' }],
          companyIds: ['company-2'],
        },
      ],
    })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      userId, ['customers.people.view'], { tenantId, organizationId: firstOrganizationId },
    )
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      userId, ['customers.companies.view'], { tenantId, organizationId: secondOrganizationId },
    )
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(2)
  })

  it.each([null, secondOrganizationId])('leaves associations empty with mismatched or missing row scope %s', async (reportedOrganizationId) => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockQuery.mockResolvedValueOnce({
      items: [{
        id: fixtures[0].id,
        title: fixtures[0].title,
        organization_id: reportedOrganizationId,
        tenant_id: tenantId,
      }],
      total: 1,
    })

    const response = await GET(new Request(listUrl))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 1,
      items: [{ id: fixtures[0].id, ...noAssociations }],
    })
  })

  it.each(['view', 'full'])('applies the same association grants to the %s CSV export', async (exportScope) => {
    const response = await GET(new Request(`${listUrl}?format=csv&exportScope=${exportScope}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    const csv = await response.text()
    expect(csv).toContain('First Deal')
    expect(csv).toContain('Second Deal')
    expect(csv).toContain('First Contact')
    expect(csv).toContain('Second Company')
    expect(csv).not.toContain('Second Contact')
    expect(csv).not.toContain('First Company')
  })

  it.each(['permissions change', 'association loading fails'])(
    'clears cached association values when %s',
    async (condition) => {
      mockUserHasAllFeatures.mockResolvedValue(true)
      const warmResponse = await GET(new Request(listUrl))
      expect(warmResponse.status).toBe(200)
      expect(warmResponse.headers.get('x-om-cache')).toBe('miss')
      expect((await warmResponse.json()).items[0]).toMatchObject({
        people: [{ label: 'First Contact' }],
        companies: [{ label: 'First Company' }],
      })

      if (condition === 'permissions change') {
        mockUserHasAllFeatures.mockResolvedValue(false)
      } else {
        mockFindWithDecryption.mockRejectedValue(new Error('Association loading failed'))
      }

      const cachedResponse = await GET(new Request(listUrl))

      expect(cachedResponse.status).toBe(200)
      expect(cachedResponse.headers.get('x-om-cache')).toBe('hit')
      expect(await cachedResponse.json()).toMatchObject({
        total: 2,
        items: fixtures.map(({ id }) => ({ id, ...noAssociations })),
      })
      expect(mockQuery).toHaveBeenCalledTimes(1)
    },
  )
})
