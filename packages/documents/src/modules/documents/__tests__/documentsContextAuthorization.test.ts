const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ORGANIZATION_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const ROLE_ID = '55555555-5555-4555-8555-555555555555'
const API_KEY_ID = '66666666-6666-4666-8666-666666666666'
const API_KEY_SUBJECT = `api_key:${API_KEY_ID}`
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

type Acl = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

const activeUserRoles: Array<{
  user: string
  role: { id: string; tenantId: string; deletedAt: Date | null }
  deletedAt: Date | null
}> = []

const em = { findOne: jest.fn(async () => null), find: jest.fn(async () => []) }

const rbacService = {
  loadAcl: jest.fn<Promise<Acl>, [string, { tenantId: string | null; organizationId: string | null }]>(
    async () => ({ isSuperAdmin: false, features: ['documents.view'], organizations: null }),
  ),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'organizationScopeService') return {
      resolve: jest.fn(),
      resolveFresh: jest.fn(),
      resolveForRequest: (input: unknown) => mockResolveOrganizationScopeForRequest(input),
    }
    if (name === 'authPrincipalService') return {
      principalExists: jest.fn(),
      resolveLabels: jest.fn(),
      filterActiveRoleIds: jest.fn(async (ids: string[]) => ids),
      listSuperAdminUserIds: jest.fn(async () => []),
      resolveActiveUserRoleIds: jest.fn(async (userId: string, scope: { tenantId: string }) =>
        activeUserRoles.filter((assignment) => assignment.user === userId
          && assignment.deletedAt === null
          && assignment.role.tenantId === scope.tenantId
          && assignment.role.deletedAt === null)
          .map((assignment) => assignment.role.id)),
    }
    if (name === 'apiKeyPrincipalService') return {
      resolveAssignedRoleIds: jest.fn(async () => []),
    }
    throw new Error(`Unexpected dependency: ${name}`)
  }),
}

function interactiveAuth(overrides: Record<string, unknown> = {}) {
  return {
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
    ...overrides,
  }
}

describe('documents route authorization freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activeUserRoles.splice(0)
    mockCreateRequestContainer.mockResolvedValue(container)
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth())
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: ORGANIZATION_ID,
      filterIds: [ORGANIZATION_ID],
      allowedIds: [ORGANIZATION_ID],
      tenantId: TENANT_ID,
    })
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations: null,
    })
  })

  async function resolve(requiredFeatures = ['documents.view']) {
    const { resolveDocumentsContext } = await import('../api/_shared')
    return resolveDocumentsContext(
      new Request('http://localhost/api/documents'),
      requiredFeatures,
    )
  }

  it.each([
    ['stale feature claims', { features: ['documents.*'] }],
    ['stale superadmin claims', { isSuperAdmin: true }],
  ])('rejects %s when the live ACL has no required grant', async (_label, staleClaims) => {
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth(staleClaims))
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: [],
      organizations: null,
    })

    await expect(resolve()).rejects.toMatchObject({ status: 403 })
    if ('isSuperAdmin' in staleClaims && staleClaims.isSuperAdmin === true) {
      expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({
        auth: expect.objectContaining({ isSuperAdmin: false }),
      }))
    }
  })

  it('rejects a stale selected organization instead of falling back to another org', async () => {
    // The resolver could not honor the explicitly selected org and fell back to
    // an allowed one. Reads and writes must fail loud rather than silently
    // targeting the fallback organization.
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: ORGANIZATION_ID,
      filterIds: [ORGANIZATION_ID],
      allowedIds: [ORGANIZATION_ID],
      tenantId: TENANT_ID,
      selectionRejected: true,
    })

    await expect(resolve()).rejects.toMatchObject({
      status: 422,
      body: { code: 'organization_selection_invalid' },
    })
  })

  it('rejects a selected organization removed from the live ACL allowlist', async () => {
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations: [OTHER_ORGANIZATION_ID],
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId: TENANT_ID,
    })

    await expect(resolve()).rejects.toMatchObject({ status: 403 })
  })

  it.each([
    ['empty allowlist', []],
    ['unresolved allowlist', [OTHER_ORGANIZATION_ID]],
  ])('rejects account-organization fallback for a live %s', async (_label, organizations) => {
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations,
    })
    // This is the shared resolver's real fallback shape when the original
    // grants expand to no persisted organizations.
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: ORGANIZATION_ID,
      filterIds: [ORGANIZATION_ID],
      allowedIds: [ORGANIZATION_ID],
      tenantId: TENANT_ID,
    })

    await expect(resolve()).rejects.toMatchObject({ status: 403 })
  })

  it('accepts a selected child organization expanded from a live parent grant', async () => {
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      orgId: PARENT_ORGANIZATION_ID,
    }))
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations: [PARENT_ORGANIZATION_ID],
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: ORGANIZATION_ID,
      filterIds: [ORGANIZATION_ID],
      allowedIds: [PARENT_ORGANIZATION_ID, ORGANIZATION_ID],
      tenantId: TENANT_ID,
    })

    await expect(resolve()).resolves.toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ isSuperAdmin: false }),
    }))
  })

  it('projects role-share ids only from active current-tenant assignments', async () => {
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      roleIds: [ROLE_ID],
      roles: [ROLE_ID, 'stale-role-name'],
    }))

    await expect(resolve()).resolves.toMatchObject({ auth: { roleIds: [] } })

    activeUserRoles.push({
      user: USER_ID,
      role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
      deletedAt: null,
    })
    await expect(resolve()).resolves.toMatchObject({ auth: { roleIds: [ROLE_ID] } })
  })

  it('keeps a restricted API key on its live ACL while using its backing user for shares', async () => {
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      sub: API_KEY_SUBJECT,
      keyId: API_KEY_ID,
      userId: USER_ID,
      isApiKey: true,
      isSuperAdmin: true,
      features: ['documents.*'],
      roleIds: [ROLE_ID],
    }))
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations: [ORGANIZATION_ID],
    })

    await expect(resolve()).resolves.toMatchObject({
      auth: {
        sub: API_KEY_SUBJECT,
        userId: USER_ID,
        features: ['documents.view'],
        isSuperAdmin: false,
        roleIds: [],
      },
    })
    expect(rbacService.loadAcl).toHaveBeenCalledWith(API_KEY_SUBJECT, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it('uses a validated unbound API-key UUID as the domain actor without changing its ACL subject', async () => {
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      sub: API_KEY_SUBJECT,
      keyId: API_KEY_ID,
      userId: undefined,
      isApiKey: true,
    }))
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations: [ORGANIZATION_ID],
    })
    await expect(resolve()).resolves.toMatchObject({
      auth: {
        sub: API_KEY_SUBJECT,
        keyId: API_KEY_ID,
        userId: API_KEY_ID,
        features: ['documents.view'],
      },
    })
    expect(rbacService.loadAcl).toHaveBeenCalledWith(API_KEY_SUBJECT, expect.anything())
  })

  it.each([
    ['missing', undefined],
    ['mismatched', OTHER_USER_ID],
  ])('rejects a key with a %s validated keyId instead of parsing auth.sub', async (_label, keyId) => {
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      sub: API_KEY_SUBJECT,
      keyId,
      userId: undefined,
      isApiKey: true,
    }))

    await expect(resolve()).rejects.toMatchObject({ status: 403 })
    expect(rbacService.loadAcl).not.toHaveBeenCalled()
  })

  it('keeps a superadmin viewing "all organizations" on their own organization', async () => {
    // The super-admin switcher override clears `auth.orgId` and preserves the
    // account organization in `actorOrgId`. Every document row belongs to one
    // organization, so fall back to the operator's own org rather than 403.
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      orgId: null,
      actorOrgId: ORGANIZATION_ID,
      isSuperAdmin: true,
    }))
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: true,
      features: [],
      organizations: null,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: TENANT_ID,
    })

    await expect(resolve()).resolves.toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      auth: { orgId: ORGANIZATION_ID, organizationId: ORGANIZATION_ID, isSuperAdmin: true },
    })
  })

  it('answers 400 organization_scope_required when a superadmin views a foreign tenant with "all organizations"', async () => {
    // The actor organization belongs to another tenant, so it must not be
    // reused; a 400 (not 401, which would loop through session refresh, and
    // not 403, which reads as denied) tells the caller to pick an organization.
    mockGetAuthFromRequest.mockResolvedValue(interactiveAuth({
      tenantId: '99999999-9999-4999-8999-999999999999',
      actorTenantId: TENANT_ID,
      orgId: null,
      actorOrgId: ORGANIZATION_ID,
      isSuperAdmin: true,
    }))
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: true,
      features: [],
      organizations: null,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: '99999999-9999-4999-8999-999999999999',
    })

    await expect(resolve()).rejects.toMatchObject({
      status: 400,
      body: { code: 'organization_scope_required' },
    })
  })

  it('projects live superadmin as wildcard features for downstream query contexts', async () => {
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: true,
      features: [],
      organizations: null,
    })

    await expect(resolve()).resolves.toMatchObject({
      auth: { isSuperAdmin: true, features: ['*'] },
    })
  })
})
