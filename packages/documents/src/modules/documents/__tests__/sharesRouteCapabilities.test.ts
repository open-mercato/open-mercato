import { Document, DocumentShare } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const OWNER_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'

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

type SharesRoute = typeof import('../api/[id]/shares/route')

type EntityManagerDouble = {
  findOne: jest.Mock
  find: jest.Mock
}

let GET: SharesRoute['GET']
let POST: SharesRoute['POST']
let PUT: SharesRoute['PUT']
let DELETE: SharesRoute['DELETE']
let features: string[]
let ownerUserId: string
let shareRecord: Record<string, unknown> | null
let em: EntityManagerDouble

const rbacService = {
  loadAcl: jest.fn(async () => ({
    isSuperAdmin: false,
    features,
    organizations: null,
  })),
}
const commandExecute = jest.fn()
const commandBus = { execute: (...args: unknown[]) => commandExecute(...args) }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'commandBus') return commandBus
    return undefined
  }),
}

beforeAll(async () => {
  const route = await import('../api/[id]/shares/route')
  GET = route.GET
  POST = route.POST
  PUT = route.PUT
  DELETE = route.DELETE
})

beforeEach(() => {
  jest.clearAllMocks()
  features = []
  ownerUserId = OWNER_ID
  shareRecord = null
  em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === DocumentShare) return shareRecord
      if (entity !== Document) return null
      return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        ownerUserId,
        deletedAt: null,
      }
    }),
    find: jest.fn(async (entity: unknown) => entity === DocumentShare ? [] : []),
  }
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
  commandExecute.mockResolvedValue({
    result: {
      id: '77777777-7777-4777-8777-777777777777',
      updatedAt: '2026-07-10T10:00:00.000Z',
    },
    logEntry: null,
  })
})

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/shares`)
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('document shares capability gate', () => {
  it('rejects documents.manage without the separate share action feature', async () => {
    features = ['documents.manage']

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
  })

  it('rejects documents.share without owner tier or manager override', async () => {
    features = ['documents.share']

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
  })

  it('allows an owner with documents.share', async () => {
    features = ['documents.share']
    ownerUserId = USER_ID

    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], truncated: false })
  })

  it('allows a manager only when documents.share is also granted', async () => {
    features = ['documents.manage', 'documents.share']

    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], truncated: false })
  })

  it('dispatches share creation through the scoped stable-id command', async () => {
    features = ['documents.share']
    ownerUserId = USER_ID
    const response = await POST(new Request(
      `http://localhost/api/documents/${DOCUMENT_ID}/shares`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          principalType: 'user',
          principalId: '66666666-6666-4666-8666-666666666666',
          permission: 'viewer',
        }),
      },
    ), context())

    expect(response.status).toBe(201)
    expect(commandExecute).toHaveBeenCalledWith(
      'documents.share.create',
      expect.objectContaining({ input: expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        shareId: expect.any(String),
        actorUserId: USER_ID,
        share: {
          principalType: 'user',
          principalId: '66666666-6666-4666-8666-666666666666',
          permission: 'viewer',
        },
      }) }),
    )
  })

  it.each([
    ['PUT', 'documents.share.update'],
    ['DELETE', 'documents.share.delete'],
  ] as const)('dispatches %s through %s with the current share version', async (method, commandId) => {
    features = ['documents.share']
    ownerUserId = USER_ID
    shareRecord = {
      id: '77777777-7777-4777-8777-777777777777',
      documentId: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      principalType: 'user',
      principalId: '66666666-6666-4666-8666-666666666666',
      permission: 'viewer',
      createdByUserId: USER_ID,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      updatedAt: new Date('2026-07-10T10:00:00.000Z'),
      deletedAt: null,
    }
    const handler = method === 'PUT' ? PUT : DELETE
    const response = await handler(new Request(
      `http://localhost/api/documents/${DOCUMENT_ID}/shares`,
      {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(method === 'PUT'
          ? { id: shareRecord.id, permission: 'editor' }
          : { id: shareRecord.id }),
      },
    ), context())

    expect(response.status).toBe(200)
    expect(commandExecute).toHaveBeenCalledWith(
      commandId,
      expect.objectContaining({ input: expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        actorUserId: USER_ID,
        expectedUpdatedAt: '2026-07-10T10:00:00.000Z',
      }) }),
    )
  })
})
