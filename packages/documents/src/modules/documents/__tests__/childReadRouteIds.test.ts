import { Document } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

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

type ReadHandler = typeof import('../api/[id]/content/route')['GET']

let routes: Array<{ name: string; GET: ReadHandler }>
let features: string[]
let ownerUserId: string
let exists: boolean

const em = {
  findOne: jest.fn(async (entity: unknown) => entity === Document && exists ? {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ownerUserId,
    deletedAt: null,
  } : null),
  find: jest.fn(async () => []),
  findAndCount: jest.fn(async () => [[], 0]),
}

const rbacService = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: false, features, organizations: null })),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    return undefined
  }),
}

beforeAll(async () => {
  routes = [
    { name: 'content', GET: (await import('../api/[id]/content/route')).GET },
    { name: 'versions', GET: (await import('../api/[id]/versions/route')).GET },
    { name: 'comments', GET: (await import('../api/[id]/comments/route')).GET },
    { name: 'shares', GET: (await import('../api/[id]/shares/route')).GET },
  ]
})

beforeEach(() => {
  jest.clearAllMocks()
  features = ['documents.view', 'documents.share']
  ownerUserId = USER_ID
  exists = true
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID, userId: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID,
    roles: [], features: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID, tenantId: TENANT_ID,
  })
})

function read(name: string, id: string): Promise<Response> {
  const route = routes.find((entry) => entry.name === name)
  if (!route) throw new Error('[internal] Missing child read route')
  return route.GET(
    new Request(`http://localhost/api/documents/${id}/${name}`),
    { params: Promise.resolve({ id }) },
  )
}

function expectNoRecordAccess(): void {
  expect(em.findOne).not.toHaveBeenCalled()
  expect(em.find).not.toHaveBeenCalled()
  expect(em.findAndCount).not.toHaveBeenCalled()
}

describe.each(['content', 'versions', 'comments', 'shares'])('%s child read IDs', (name) => {
  it.each(['abc', '44444444-4444-4444-8444-44444444444z'])(
    'returns not found for malformed ID %s without record access',
    async (id) => {
      const response = await read(name, id)

      expect(response.status).toBe(404)
      expectNoRecordAccess()
    },
  )

  it.each(['abc', DOCUMENT_ID])('retains authentication precedence for %s', async (id) => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    expect((await read(name, id)).status).toBe(401)
    expectNoRecordAccess()
    expect(rbacService.loadAcl).not.toHaveBeenCalled()
  })

  it('retains feature authorization precedence for malformed IDs', async () => {
    features = []

    expect((await read(name, 'abc')).status).toBe(403)
    expectNoRecordAccess()
  })

  it('serves valid scoped IDs through the existing permission and child queries', async () => {
    expect((await read(name, DOCUMENT_ID)).status).toBe(200)
    expect(em.findOne).toHaveBeenCalledWith(
      Document,
      expect.objectContaining({
        id: DOCUMENT_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
      }),
      undefined,
    )
    const childQuery = name === 'versions' ? em.findAndCount
      : name === 'content' ? em.findOne : em.find
    expect(childQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        documentId: DOCUMENT_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
      }),
      name === 'content' ? undefined : expect.anything(),
    )
  })

  it('keeps valid inaccessible IDs concealed behind forbidden', async () => {
    ownerUserId = OTHER_USER_ID

    expect((await read(name, DOCUMENT_ID)).status).toBe(403)
    expect(em.findAndCount).not.toHaveBeenCalled()
  })

  it('keeps valid unknown IDs concealed behind forbidden', async () => {
    exists = false

    expect((await read(name, DOCUMENT_ID)).status).toBe(403)
    expect(em.findAndCount).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })
})
