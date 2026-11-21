import { GET, POST, DELETE } from '../domain-mappings'
import { POST as verify } from '../domain-mappings/[id]/verify'
import { POST as healthCheck } from '../domain-mappings/[id]/health-check'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key === 'customer_accounts.domainMapping.dns.txtNameTooLong' ? 'localized TXT hostname guidance' : key }),
}))

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
      if (name === 'crudMutationGuardService') return null
      if (name === 'em') return { find: mockFind }
      if (name === 'domainMappingService') return mockService
      throw new Error(`[internal] Unexpected service: ${name}`)
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFind(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockGuard(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/services/domainMappingService', () => ({
  DomainMappingOrgScopeError: class extends Error {},
  DomainMappingRegistrationConflict: class extends Error {},
  DomainMappingUnavailableError: class extends Error {},
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
  mockGuard.mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })
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
    expect(body.domainMappings[0]).toMatchObject({
      ownershipRecord: { name: '_om-verify.portal.example.test', value: `open-mercato-verification=${mappingId}` },
      verificationExpiresAt: '2026-10-03T00:00:00.000Z',
    })
    expect(mockResolveFeatureOrganizationAccess).toHaveBeenCalledTimes(1)
    expect(mockResolveFeatureOrganizationAccess).toHaveBeenCalledWith(userId, [feature], { tenantId })
    expect(mockUserHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenNthCalledWith(1,
      expect.anything(), expect.anything(), { tenant: tenantId, deletedAt: null },
      { fields: ['id', 'ancestorIds'] }, { tenantId },
    )
    expect(mockFilterOrganizationIds).toHaveBeenCalledWith(organizations)
    expect(mockFind).toHaveBeenNthCalledWith(2,
      expect.anything(), expect.anything(), expect.objectContaining({ tenantId, organizationId: { $in: [organizationA] }, deletedAt: null, $or: expect.any(Array) }),
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
      expect.anything(), expect.anything(), expect.objectContaining({ tenantId, deletedAt: null }), { orderBy: { createdAt: 'desc' } },
      { tenantId, organizationId: null },
    )
  })

  it('uses an empty organization constraint when bulk authorization denies every organization', async () => {
    mockFilterOrganizationIds.mockReturnValue([])

    const response = await GET(new Request(baseUrl))

    expect(response.status).toBe(200)
    expect((await response.json()).domainMappings).toEqual([])
    expect(mockFind).toHaveBeenLastCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ tenantId, organizationId: { $in: [] }, deletedAt: null }),
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
      expect.anything(), expect.anything(), expect.objectContaining({ tenantId, organizationId: organizationA, deletedAt: null }),
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
    mockGuard.mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })

    expect((await POST(createRequest(organizationA))).status).toBe(201)
    expect(mockService.register).toHaveBeenCalledWith({
      hostname: 'portal.example.test', tenantId, organizationId: organizationA, replacesDomainId: undefined,
    })
    expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('honors mutation guard rejection for an authorized organization', async () => {
    mockGuard.mockResolvedValue({ ok: false, response: Response.json({ error: 'Conflict' }, { status: 409 }) })

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
    mockGuard.mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })

    expect((await invoke()).status).toBe(200)
    expect(mutation).toHaveBeenCalled()
    expect(mockGuard).toHaveBeenCalledWith(expect.objectContaining({ auth: expect.objectContaining({ organizationId: organizationA }) }))
    expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('preserves tenant-scoped not-found handling', async () => {
    mockService.findById.mockResolvedValue(null)

    expect((await invoke()).status).toBe(404)
    expect(mockService.findById).toHaveBeenCalledWith(mappingId, { tenantId })
    expect(mutation).not.toHaveBeenCalled()
  })

  it('honors guard rejection before the authorized operation', async () => {
    mockGuard.mockResolvedValue({ ok: false, response: Response.json({ error: 'Conflict' }, { status: 409 }) })

    expect((await invoke()).status).toBe(409)
    expect(mutation).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })
})

describe('domain action lifecycle refusals', () => {
  it('passes the client version to locked removal and preserves its standard conflict', async () => {
    const expectedUpdatedAt = '2026-10-01T00:00:00.000Z'
    const conflict = {
      error: 'record_modified', code: 'optimistic_lock_conflict',
      currentUpdatedAt: '2026-10-01T00:00:01.000Z', expectedUpdatedAt,
    }
    mockService.remove.mockRejectedValueOnce(new CrudHttpError(409, conflict))
    mockGuard.mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })

    const response = await DELETE(new Request(`${baseUrl}?id=${mappingId}`, {
      method: 'DELETE', headers: { 'x-om-ext-optimistic-lock-expected-updated-at': expectedUpdatedAt },
    }))

    expect(mockService.remove).toHaveBeenCalledWith(mappingId, { tenantId, expectedUpdatedAt, container: expect.anything() })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(conflict)
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it('returns a documented conflict when the domain is not ready for a TLS check', async () => {
    mockService.healthCheck.mockRejectedValueOnce(Object.assign(new Error('[internal] Pending mapping'), {
      [Symbol.for('@open-mercato/CrudHttpError')]: true,
      status: 409,
      body: { error: '[internal] Pending mapping', code: 'domain_mapping_not_verified' },
    }))
    mockGuard.mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })

    const response = await healthCheck(new Request(`${baseUrl}/${mappingId}/health-check`, { method: 'POST' }), {
      params: Promise.resolve({ id: mappingId }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false, error: 'customer_accounts.domainMapping.dns.txtUnverified', code: 'domain_mapping_not_verified',
    })
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })
})


describe('domain registry-only guards', () => {
  const operations = [
    { name: 'create', invoke: () => POST(createRequest(organizationA)), mutation: mockService.register, operation: 'create' },
    ...actions.map((action) => ({ ...action, operation: action.name === 'delete' ? 'delete' : 'update' })),
  ]

  it.each(operations)('blocks $name before writes using a registered guard', async ({ invoke, mutation, operation }) => {
    const { registerMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/mutation-guard-store')>('@open-mercato/shared/lib/crud/mutation-guard-store')
    const { runRouteMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/route-mutation-guard')>('@open-mercato/shared/lib/crud/route-mutation-guard')
    const validate = jest.fn(async () => ({ ok: false as const, status: 409, body: { error: 'domain locked' } }))
    registerMutationGuards([{ moduleId: 'customer_accounts', guards: [{
      id: 'customer_accounts.domain-regression', targetEntity: 'customer_accounts.domain_mapping',
      operations: ['create', 'update', 'delete'], validate,
    }] }])
    mockGuard.mockImplementationOnce(runRouteMutationGuards)
    try {
      const response = await invoke()
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'domain locked' })
      expect(validate).toHaveBeenCalledWith(expect.objectContaining({ tenantId, organizationId: organizationA, operation }))
      expect(mutation).not.toHaveBeenCalled()
    } finally {
      registerMutationGuards([])
    }
  })

  it.each(operations)('runs registered $name success callbacks after the service mutation', async ({ invoke, mutation }) => {
    const { registerMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/mutation-guard-store')>('@open-mercato/shared/lib/crud/mutation-guard-store')
    const { runRouteMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/route-mutation-guard')>('@open-mercato/shared/lib/crud/route-mutation-guard')
    const afterSuccess = jest.fn(async () => {
      expect(mutation).toHaveBeenCalledTimes(1)
    })
    registerMutationGuards([{ moduleId: 'customer_accounts', guards: [{
      id: 'customer_accounts.domain-success-regression', targetEntity: 'customer_accounts.domain_mapping',
      operations: ['create', 'update', 'delete'],
      validate: async () => ({ ok: true, shouldRunAfterSuccess: true }), afterSuccess,
    }] }])
    mockGuard.mockImplementationOnce(runRouteMutationGuards)
    try {
      expect((await invoke()).status).toBe(mutation === mockService.register ? 201 : 200)
      expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ tenantId, organizationId: organizationA, resourceId: mappingId }))
    } finally {
      registerMutationGuards([])
    }
  })

  it('uses a validated transformed hostname without changing the authorized organization', async () => {
    mockGuard.mockResolvedValueOnce({ ok: true, modifiedPayload: { hostname: 'updated.example.test' }, runAfterSuccess: mockAfterSuccess })
    expect((await POST(createRequest(organizationA))).status).toBe(201)
    expect(mockService.register).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'updated.example.test', organizationId: organizationA, tenantId }))
    expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('refuses a guard transformation into an unauthorized organization', async () => {
    mockGuard.mockResolvedValueOnce({ ok: true, modifiedPayload: { organizationId: organizationB }, runAfterSuccess: mockAfterSuccess })
    expect((await POST(createRequest(organizationA))).status).toBe(400)
    expect(mockService.register).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it('translates the overlong TXT name field error before returning it', async () => {
    const hostname = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(51)].join('.')
    const response = await POST(new Request(baseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hostname, organizationId: organizationA }) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ issues: { fieldErrors: { hostname: ['localized TXT hostname guidance'] } } })
    expect(mockService.register).not.toHaveBeenCalled()
  })
})
