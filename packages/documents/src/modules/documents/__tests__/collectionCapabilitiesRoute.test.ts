const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockGetVisibleDocumentPage = jest.fn()
const mockResolveUserLabels = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))
jest.mock('../lib/platformServices', () => ({
  ...jest.requireActual('../lib/platformServices'),
  resolveOrganizationScopeService: () => ({
    resolve: jest.fn(), resolveFresh: jest.fn(),
    resolveForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
  }),
}))
jest.mock('../lib/visibility', () => ({
  getVisibleDocumentPage: (...args: unknown[]) => mockGetVisibleDocumentPage(...args),
}))
jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

const em = { find: jest.fn(), createQueryBuilder: jest.fn() }
const rbacService = { loadAcl: jest.fn() }
const queryEngine = { query: jest.fn() }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return em
    if (token === 'rbacService') return rbacService
    if (token === 'queryEngine') return queryEngine
    return undefined
  }),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
    features: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  })
  mockGetVisibleDocumentPage.mockResolvedValue({ rows: [], total: 0 })
  mockResolveUserLabels.mockResolvedValue(new Map())
})

describe('GET /api/documents collection capabilities', () => {
  it.each([
    {
      features: ['documents.view'],
      expected: {
        canCreateDocument: false,
        canCreateFolder: false,
        canLinkDocuments: false,
        canInstantiateTemplate: false,
        canManageTemplates: false,
      },
    },
    {
      features: ['documents.view', 'documents.create', 'documents.edit'],
      expected: {
        canCreateDocument: true,
        canCreateFolder: true,
        canLinkDocuments: true,
        canInstantiateTemplate: true,
        canManageTemplates: false,
      },
    },
    {
      features: ['*'],
      expected: {
        canCreateDocument: true,
        canCreateFolder: true,
        canLinkDocuments: true,
        canInstantiateTemplate: true,
        canManageTemplates: true,
      },
    },
  ])('returns independent action flags for $features', async ({ features, expected }) => {
    rbacService.loadAcl.mockResolvedValue({ isSuperAdmin: false, features, organizations: null })
    const { GET } = await import('../api/route')

    const response = await GET(new Request('http://localhost/api/documents?page=1&pageSize=50'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [],
      total: 0,
      collectionCapabilities: expected,
    })
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('hydrates only page ids with UMES context and aggregates share counts in SQL', async () => {
    const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.view'],
      organizations: null,
    })
    mockGetVisibleDocumentPage.mockResolvedValue({
      rows: [{ id: documentId, relationshipTier: 'viewer', total: 1 }],
      total: 1,
    })
    queryEngine.query.mockResolvedValue({
      items: [{
        id: documentId,
        title: 'Bounded document',
        folderId: null,
        ownerUserId: USER_ID,
        createdByUserId: USER_ID,
        isActive: true,
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        updatedAt: new Date('2026-07-10T10:00:00.000Z'),
      }],
    })
    const groupedQuery = {
      select: jest.fn(),
      where: jest.fn(),
      groupBy: jest.fn(),
      execute: jest.fn(async () => [{ documentId, shareCount: '27' }]),
    }
    groupedQuery.select.mockReturnValue(groupedQuery)
    groupedQuery.where.mockReturnValue(groupedQuery)
    groupedQuery.groupBy.mockReturnValue(groupedQuery)
    em.createQueryBuilder.mockReturnValue(groupedQuery)
    em.find.mockResolvedValue([])
    const { GET } = await import('../api/route')

    const response = await GET(new Request('http://localhost/api/documents?page=1&pageSize=100'))
    const body = await response.json() as { items?: Array<{ sharedWithCount?: number; createdAt?: string }> }

    expect(response.status).toBe(200)
    expect(body.items?.[0]?.sharedWithCount).toBe(27)
    expect(body.items?.[0]?.createdAt).toBe('2026-07-10T10:00:00.000Z')
    expect(queryEngine.query).toHaveBeenCalledWith('documents:document', expect.objectContaining({
      filters: { id: { $in: [documentId] } },
      page: { page: 1, pageSize: 1 },
      extensions: expect.objectContaining({
        userId: USER_ID,
        container,
        userFeatures: ['documents.view'],
        resolve: expect.any(Function),
      }),
    }))
    expect(groupedQuery.groupBy).toHaveBeenCalledWith('document_share.documentId')
    expect(groupedQuery.execute).toHaveBeenCalledTimes(1)
  })
})
