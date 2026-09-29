const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'
const PRINCIPAL_ID = '44444444-4444-4444-8444-444444444444'

const mockResolveDocumentsContext = jest.fn()
const mockResolveDocumentCapabilityProjection = jest.fn()
const mockListSuperAdminUserIds = jest.fn()
const mockResolveUserLabels = jest.fn()
const mockFilterActiveRoleIds = jest.fn()
const mockQueryActiveRolePage = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('../api/_shared', () => {
  const actual = jest.requireActual<typeof import('../api/_shared')>('../api/_shared')
  return {
    ...actual,
    resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
    resolveDocumentCapabilityProjection: (...args: unknown[]) => mockResolveDocumentCapabilityProjection(...args),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => ({
      'documents.users.unknown': 'Unknown user',
      'documents.roles.unknown': 'Unknown role',
      'api.errors.forbidden': 'Forbidden',
    })[key] ?? fallback ?? key,
  })),
  withDocumentsContextErrors: (doc: unknown) => doc,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

const queryEngine = { query: jest.fn() }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'queryEngine') return queryEngine
    if (token === 'authPrincipalService') return {
      principalExists: jest.fn(),
      resolveActiveUserRoleIds: jest.fn(),
      filterActiveRoleIds: (...args: unknown[]) => mockFilterActiveRoleIds(...args),
      resolveLabels: jest.fn(),
      queryActiveRolePage: (...args: unknown[]) => mockQueryActiveRolePage(...args),
      listSuperAdminUserIds: (...args: unknown[]) => mockListSuperAdminUserIds(...args),
    }
    throw new Error('missing')
  }),
}

type PrincipalsRoute = typeof import('../api/[id]/principals/route')
let GET: PrincipalsRoute['GET']
let metadata: PrincipalsRoute['metadata']
let openApi: PrincipalsRoute['openApi']

beforeAll(async () => {
  const route = await import('../api/[id]/principals/route')
  GET = route.GET
  metadata = route.metadata
  openApi = route.openApi
})

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveDocumentsContext.mockResolvedValue({
    container,
    auth: { sub: PRINCIPAL_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isSuperAdmin: false },
    em: {},
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
  })
  mockResolveDocumentCapabilityProjection.mockResolvedValue({
    relationshipTier: 'owner',
    capabilities: { canComment: true, canShare: true },
  })
  mockListSuperAdminUserIds.mockResolvedValue([])
  mockFilterActiveRoleIds.mockImplementation(async (ids: string[]) => ids)
  mockQueryActiveRolePage.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
  mockFindWithDecryption.mockResolvedValue([])
  mockResolveUserLabels.mockResolvedValue(new Map([
    [PRINCIPAL_ID, { label: 'Ada Lovelace', secondary: 'ada@example.test' }],
  ]))
  queryEngine.query.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
})

function request(query: string): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/principals?${query}`)
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('document-scoped principal picker route', () => {
  it('searches eligible mention users through flat encrypted QueryEngine fields and returns only display data', async () => {
    const matchedPage = {
      items: [{
        id: PRINCIPAL_ID,
        name: 'Ada Lovelace',
        email: 'ada@example.test',
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        passwordHash: 'must-not-leak',
      }],
      page: 1,
      pageSize: 8,
      total: 1,
    }
    queryEngine.query
      .mockResolvedValueOnce(matchedPage)
      .mockResolvedValueOnce(matchedPage)
      .mockResolvedValueOnce({ items: [{ id: PRINCIPAL_ID }], page: 1, pageSize: 1, total: 1 })

    const response = await GET(
      request('mode=mention&type=user&search=Ada&page=1&pageSize=8'),
      context(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      items: [{ id: PRINCIPAL_ID, label: 'Ada Lovelace', secondary: 'ada@example.test' }],
      page: 1,
      pageSize: 8,
      total: 1,
      totalPages: 1,
    })
    expect(mockResolveDocumentsContext).toHaveBeenCalledWith(expect.any(Request), ['documents.view'])
    expect(mockResolveDocumentCapabilityProjection).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      DOCUMENT_ID,
    )
    expect(queryEngine.query).toHaveBeenCalledTimes(3)
    expect(queryEngine.query).toHaveBeenNthCalledWith(1, 'auth:user', expect.objectContaining({
      fields: ['id'],
      tenantId: TENANT_ID,
      organizationIds: [ORGANIZATION_ID, ''],
      withDeleted: false,
      filters: {
        is_confirmed: true,
        name: { $ilike: '%Ada%' },
      },
      page: { page: 1, pageSize: 8 },
    }))
    expect(queryEngine.query).toHaveBeenNthCalledWith(2, 'auth:user', expect.objectContaining({
      fields: ['id'],
      tenantId: TENANT_ID,
      organizationIds: [ORGANIZATION_ID, ''],
      withDeleted: false,
      filters: {
        is_confirmed: true,
        email: { $ilike: '%Ada%' },
      },
      page: { page: 1, pageSize: 8 },
    }))
    expect(queryEngine.query).toHaveBeenNthCalledWith(3, 'auth:user', expect.objectContaining({
      fields: ['id'],
      tenantId: TENANT_ID,
      organizationIds: [ORGANIZATION_ID, ''],
      withDeleted: false,
      filters: {
        is_confirmed: true,
        name: { $ilike: '%Ada%' },
        email: { $ilike: '%Ada%' },
      },
      sort: [{ field: 'id', dir: 'asc' }],
      page: { page: 1, pageSize: 1 },
    }))
    expect(mockResolveUserLabels).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [PRINCIPAL_ID],
    )
  })

  it('merges tokenized name and email branches before paginating and keeps an exact union total', async () => {
    const ids = {
      alpha: '50000000-0000-4000-8000-000000000001',
      bravo: '50000000-0000-4000-8000-000000000002',
      charlie: '50000000-0000-4000-8000-000000000003',
      emailOnly: '50000000-0000-4000-8000-000000000004',
    }
    queryEngine.query
      .mockResolvedValueOnce({
        items: [
          { id: ids.alpha, name: 'Alpha', email: 'alpha@example.test' },
          { id: ids.bravo, name: 'Bravo', email: 'bravo@example.test' },
          { id: ids.charlie, name: 'Charlie', email: 'charlie@example.test' },
        ],
        page: 1,
        pageSize: 4,
        total: 3,
      })
      .mockResolvedValueOnce({
        items: [
          { id: ids.bravo, name: 'Bravo', email: 'bravo@example.test' },
          { id: ids.emailOnly, name: 'Zulu', email: 'needle@example.test' },
        ],
        page: 1,
        pageSize: 4,
        total: 2,
      })
      .mockResolvedValueOnce({ items: [{ id: ids.bravo }], page: 1, pageSize: 1, total: 1 })
    mockResolveUserLabels.mockResolvedValueOnce(new Map([
      [ids.charlie, { label: 'Charlie', secondary: 'charlie@example.test' }],
      [ids.emailOnly, { label: 'Zulu', secondary: 'needle@example.test' }],
    ]))

    const response = await GET(
      request('mode=mention&type=user&search=needle&page=2&pageSize=2'),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [
        { id: ids.charlie, label: 'Charlie', secondary: 'charlie@example.test' },
        { id: ids.emailOnly, label: 'Zulu', secondary: 'needle@example.test' },
      ],
      page: 2,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    })
    expect(queryEngine.query).toHaveBeenNthCalledWith(1, 'auth:user', expect.objectContaining({
      page: { page: 1, pageSize: 4 },
      filters: { is_confirmed: true, name: { $ilike: '%needle%' } },
    }))
    expect(queryEngine.query).toHaveBeenNthCalledWith(2, 'auth:user', expect.objectContaining({
      page: { page: 1, pageSize: 4 },
      filters: { is_confirmed: true, email: { $ilike: '%needle%' } },
    }))
  })

  it('lists active roles by default for sharing without any broad Auth list grant', async () => {
    mockQueryActiveRolePage.mockResolvedValue({
      items: [{ id: PRINCIPAL_ID, label: 'Sales team', secondary: null }],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    const response = await GET(request('mode=share&type=role'), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: PRINCIPAL_ID, label: 'Sales team', secondary: null }],
      total: 1,
    })
    expect(mockResolveDocumentsContext).toHaveBeenCalledWith(expect.any(Request), ['documents.share'])
    expect(mockQueryActiveRolePage).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      search: undefined,
      excludedIds: [],
      page: 1,
      pageSize: 20,
    })
    expect(queryEngine.query).not.toHaveBeenCalled()
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['documents.view'] })
    expect(JSON.stringify(metadata)).not.toContain('auth.roles')
    expect(JSON.stringify(openApi)).toContain('Document-scoped principal picker')
  })

  it('omits roles whose ACL does not apply to the document organization', async () => {
    const roleB = '50000000-0000-4000-8000-000000000002'
    mockQueryActiveRolePage.mockResolvedValue({
      items: [{ id: roleB, label: 'Organization B team', secondary: null }],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    const response = await GET(request('mode=share&type=role'), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: roleB, label: 'Organization B team', secondary: null }],
      total: 1,
      totalPages: 1,
    })
    expect(mockQueryActiveRolePage).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    }))
    expect(mockFilterActiveRoleIds).not.toHaveBeenCalled()
  })

  it('delegates sparse role eligibility to one bounded Auth-owned page query', async () => {
    const eligibleRole = {
      id: '50000000-0000-4000-9000-000000000001',
      label: 'Eligible role',
      secondary: null,
    }
    mockQueryActiveRolePage.mockResolvedValue({
      items: [eligibleRole],
      page: 1,
      pageSize: 1,
      total: 1,
    })

    const response = await GET(request('mode=share&type=role&page=1&pageSize=1'), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [eligibleRole],
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    })
    expect(mockQueryActiveRolePage).toHaveBeenCalledTimes(1)
    expect(mockQueryActiveRolePage).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 1 }))
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('keeps already-shared roles out of the bounded eligible role window', async () => {
    const existingRole = '50000000-0000-4000-8000-000000000001'
    const freshRole = '50000000-0000-4000-8000-000000000002'
    mockFindWithDecryption.mockResolvedValueOnce([{ principalId: existingRole }])
    mockQueryActiveRolePage.mockResolvedValue({
      items: [{ id: freshRole, label: 'Fresh team', secondary: null }],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    const response = await GET(request('mode=share&type=role'), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: freshRole, label: 'Fresh team', secondary: null }],
      total: 1,
    })
    expect(mockQueryActiveRolePage).toHaveBeenCalledWith(expect.objectContaining({
      excludedIds: [existingRole],
    }))
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('uses localized neutral labels when decrypted user fields contain embedded UUIDs', async () => {
    queryEngine.query.mockResolvedValue({
      items: [{
        id: PRINCIPAL_ID,
        name: `Agent ${PRINCIPAL_ID}`,
        email: `${PRINCIPAL_ID}@example.test`,
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    mockResolveUserLabels.mockResolvedValueOnce(new Map())

    const response = await GET(request('mode=share&type=user'), context())
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      items: [{ id: PRINCIPAL_ID, label: 'Unknown user', secondary: null }],
    })
    expect(queryEngine.query).toHaveBeenCalledWith('auth:user', expect.objectContaining({
      filters: { is_confirmed: true },
      organizationIds: [ORGANIZATION_ID, ''],
      withDeleted: false,
    }))
    const visible = JSON.stringify(body).replace(PRINCIPAL_ID, '')
    expect(visible).not.toContain(PRINCIPAL_ID)
  })

  it('fails closed before principal enumeration when the fresh document capability is insufficient', async () => {
    mockResolveDocumentCapabilityProjection.mockResolvedValue({
      relationshipTier: 'viewer',
      capabilities: { canComment: false, canShare: false },
    })

    const response = await GET(request('mode=mention&type=user&search=Ada'), context())

    expect(response.status).toBe(403)
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('excludes protected super-admin users before query, pagination, and count', async () => {
    const protectedUserId = '60000000-0000-4000-8000-000000000001'
    mockListSuperAdminUserIds.mockResolvedValueOnce([protectedUserId])
    queryEngine.query.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })

    const userResponse = await GET(
      request('mode=share&type=user&search=admin'),
      context(),
    )

    expect(userResponse.status).toBe(200)
    expect(queryEngine.query).toHaveBeenCalledTimes(3)
    for (const [, options] of queryEngine.query.mock.calls) {
      expect(options.filters).toMatchObject({ id: { $nin: [protectedUserId] } })
    }
  })

  it('lets a freshly resolved super-admin enumerate protected principals without exclusion lookups', async () => {
    mockResolveDocumentsContext.mockResolvedValueOnce({
      container,
      auth: { sub: PRINCIPAL_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isSuperAdmin: true },
      em: {},
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })

    const response = await GET(request('mode=share&type=user'), context())

    expect(response.status).toBe(200)
    expect(mockListSuperAdminUserIds).not.toHaveBeenCalled()
    expect(queryEngine.query).toHaveBeenCalledWith('auth:user', expect.objectContaining({
      filters: { is_confirmed: true },
      sort: [{ field: 'id', dir: 'asc' }],
    }))
  })

  it('caps advertised pagination at the bounded picker window', async () => {
    mockQueryActiveRolePage.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 1_000 })

    const response = await GET(request('mode=share&type=role&page=1&pageSize=20'), context())

    await expect(response.json()).resolves.toMatchObject({ total: 1_000, totalPages: 50 })
  })

  it('rejects roles in mention mode and over-broad picker pages', async () => {
    const roleResponse = await GET(request('mode=mention&type=role&search=Sales'), context())
    const pageResponse = await GET(request('mode=share&type=user&pageSize=21'), context())
    const deepPageResponse = await GET(request('mode=share&type=user&page=51'), context())
    const shortSearchResponse = await GET(request('mode=share&type=user&search=ab'), context())

    expect(roleResponse.status).toBe(400)
    expect(pageResponse.status).toBe(400)
    expect(deepPageResponse.status).toBe(400)
    expect(shortSearchResponse.status).toBe(400)
    expect(queryEngine.query).not.toHaveBeenCalled()
  })
})
