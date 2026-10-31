import { GET, POST, DELETE } from '../domain-mappings'
import { POST as verify } from '../domain-mappings/[id]/verify'
import { POST as healthCheck } from '../domain-mappings/[id]/health-check'

const mockGetAuth = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockFind = jest.fn()
const mockResolveFeatureOrganizationAccess = jest.fn()
const mockFilterOrganizationIds = jest.fn()
const mockGuard = jest.fn()
const mockAfterSuccess = jest.fn()
const mockService = {
  register: jest.fn(),
  findById: jest.fn(),
  remove: jest.fn(),
  verify: jest.fn(),
  healthCheck: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'rbacService') return {
        userHasAllFeatures: mockUserHasAllFeatures,
        resolveFeatureOrganizationAccess: mockResolveFeatureOrganizationAccess,
      }
      if (name === 'em') return { find: mockFind }
      if (name === 'domainMappingService') return mockService
      throw new Error(`[internal] Unexpected service: ${name}`)
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFind(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => mockGuard(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockAfterSuccess(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/services/domainMappingService', () => ({
  DomainMappingOrgScopeError: class extends Error {},
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationA = '22222222-2222-4222-8222-222222222222'
const organizationB = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const mappingId = '55555555-5555-4555-8555-555555555555'
const feature = 'customer_accounts.domain.manage'
const baseUrl = 'http://localhost/api/customer_accounts/admin/domain-mappings'

function mapping(organizationId = organizationA, id = mappingId) {
  return {
    id,
    hostname: 'portal.example.test',
    organizationId,
    tenantId,
    provider: 'traefik',
    status: 'pending',
    verifiedAt: null,
    lastDnsCheckAt: null,
    dnsFailureReason: null,
    tlsFailureReason: null,
    tlsRetryCount: 0,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  }
}

function createRequest(organizationId: string) {
  return new Request(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostname: 'portal.example.test', organizationId }),
  })
}

const actions = [
  {
    name: 'delete',
    invoke: () => DELETE(new Request(`${baseUrl}?id=${mappingId}`, { method: 'DELETE' })),
    mutation: mockService.remove,
  },
  {
    name: 'verify',
    invoke: () => verify(new Request(`${baseUrl}/${mappingId}/verify`, { method: 'POST' }), {
      params: Promise.resolve({ id: mappingId }),
    }),
    mutation: mockService.verify,
  },
  {
    name: 'health check',
    invoke: () => healthCheck(new Request(`${baseUrl}/${mappingId}/health-check`, { method: 'POST' }), {
      params: Promise.resolve({ id: mappingId }),
    }),
    mutation: mockService.healthCheck,
  },
]

beforeEach(() => {
  jest.resetAllMocks()
  mockGetAuth.mockResolvedValue({ sub: userId, tenantId, orgId: organizationA })
  mockUserHasAllFeatures.mockImplementation(async (_userId: string, _features: string[], scope: { organizationId: string }) => (
    scope.organizationId === organizationA
  ))
  mockFilterOrganizationIds.mockReturnValue([organizationA])
  mockResolveFeatureOrganizationAccess.mockResolvedValue({
    unrestricted: false, filterOrganizationIds: mockFilterOrganizationIds,
  })
  mockFind.mockResolvedValue([])
  mockGuard.mockResolvedValue(null)
  mockService.findById.mockResolvedValue(mapping())
  mockService.register.mockResolvedValue(mapping())
  mockService.verify.mockResolvedValue({ domainMapping: mapping(), diagnostics: null })
  mockService.healthCheck.mockResolvedValue(mapping())
})

describe('domain mapping list authorization', () => {
  it('restricts the mapping query to bulk-authorized organizations', async () => {
    const organizations = [{ id: organizationA, ancestorIds: [] }, { id: organizationB, ancestorIds: [] }]
    mockFind.mockResolvedValueOnce(organizations).mockResolvedValueOnce([mapping()])

    const response = await GET(new Request(baseUrl))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.domainMappings).toHaveLength(1)
    expect(body.domainMappings[0].organizationId).toBe(organizationA)
    expect(mockResolveFeatureOrganizationAccess).toHaveBeenCalledTimes(1)
    expect(mockResolveFeatureOrganizationAccess).toHaveBeenCalledWith(userId, [feature], { tenantId })
    expect(mockUserHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenNthCalledWith(1,
      expect.anything(), expect.anything(), { tenant: tenantId, deletedAt: null },
      { fields: ['id', 'ancestorIds'] }, { tenantId },
    )
    expect(mockFilterOrganizationIds).toHaveBeenCalledWith(organizations)
    expect(mockFind).toHaveBeenNthCalledWith(2,
      expect.anything(), expect.anything(), { tenantId, organizationId: { $in: [organizationA] } },
      { orderBy: { createdAt: 'desc' } }, { tenantId, organizationId: null },
    )
  })

  it('keeps unrestricted access tenant-scoped without organization enumeration', async () => {
    mockResolveFeatureOrganizationAccess.mockResolvedValue({ unrestricted: true })
    mockFind.mockResolvedValue([mapping(), mapping(organizationB)])

    const response = await GET(new Request(baseUrl))

    expect(response.status).toBe(200)
    expect((await response.json()).domainMappings).toHaveLength(2)
    expect(mockFind).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { tenantId }, { orderBy: { createdAt: 'desc' } },
      { tenantId, organizationId: null },
    )
  })

  it('uses an empty organization constraint when bulk authorization denies every organization', async () => {
    mockFilterOrganizationIds.mockReturnValue([])

    const response = await GET(new Request(baseUrl))

    expect(response.status).toBe(200)
    expect((await response.json()).domainMappings).toEqual([])
    expect(mockFind).toHaveBeenLastCalledWith(
      expect.anything(), expect.anything(), { tenantId, organizationId: { $in: [] } },
      { orderBy: { createdAt: 'desc' } }, { tenantId, organizationId: null },
    )
  })

  it('denies an explicit unauthorized organization filter before loading mappings', async () => {
    const response = await GET(new Request(`${baseUrl}?organizationId=${organizationB}`))

    expect(response.status).toBe(403)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('keeps authorized organization filters scoped to the tenant', async () => {
    mockFind.mockResolvedValue([mapping()])

    const response = await GET(new Request(`${baseUrl}?organizationId=${organizationA}`))

    expect(response.status).toBe(200)
    expect(mockResolveFeatureOrganizationAccess).not.toHaveBeenCalled()
    expect(mockFind).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { tenantId, organizationId: organizationA },
      { orderBy: { createdAt: 'desc' } }, { tenantId, organizationId: organizationA },
    )
  })

  it('rejects a session without a tenant before loading mappings', async () => {
    mockGetAuth.mockResolvedValue({ sub: userId, tenantId: null, orgId: organizationA })

    expect((await GET(new Request(baseUrl))).status).toBe(401)
    expect(mockFind).not.toHaveBeenCalled()
  })
})

describe('domain registration authorization', () => {
  it('denies creation in another organization before guards or registration', async () => {
    const response = await POST(createRequest(organizationB))

    expect(response.status).toBe(403)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(userId, [feature], { tenantId, organizationId: organizationB })
    expect(mockGuard).not.toHaveBeenCalled()
    expect(mockService.register).not.toHaveBeenCalled()
  })

  it('preserves authorized registration and mutation guard callbacks', async () => {
    mockGuard.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { checked: true } })

    expect((await POST(createRequest(organizationA))).status).toBe(201)
    expect(mockService.register).toHaveBeenCalledWith({
      hostname: 'portal.example.test', tenantId, organizationId: organizationA, replacesDomainId: undefined,
    })
    expect(mockAfterSuccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: organizationA, resourceId: mappingId, operation: 'create',
    }))
  })

  it('honors mutation guard rejection for an authorized organization', async () => {
    mockGuard.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    expect((await POST(createRequest(organizationA))).status).toBe(409)
    expect(mockService.register).not.toHaveBeenCalled()
  })
})

describe.each(actions)('domain $name authorization', ({ invoke, mutation }) => {
  it('checks the stored organization before guards or side effects', async () => {
    mockService.findById.mockResolvedValue(mapping(organizationB))

    expect((await invoke()).status).toBe(403)
    expect(mockService.findById).toHaveBeenCalledWith(mappingId, { tenantId })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(userId, [feature], { tenantId, organizationId: organizationB })
    expect(mockGuard).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it('preserves authorized operations and guard callbacks', async () => {
    mockGuard.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: null })

    expect((await invoke()).status).toBe(200)
    expect(mutation).toHaveBeenCalled()
    expect(mockGuard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: organizationA }))
    expect(mockAfterSuccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: organizationA }))
  })

  it('preserves tenant-scoped not-found handling', async () => {
    mockService.findById.mockResolvedValue(null)

    expect((await invoke()).status).toBe(404)
    expect(mockService.findById).toHaveBeenCalledWith(mappingId, { tenantId })
    expect(mutation).not.toHaveBeenCalled()
  })

  it('honors guard rejection before the authorized operation', async () => {
    mockGuard.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    expect((await invoke()).status).toBe(409)
    expect(mutation).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })
})
