import { Document } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

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

type DetailRoute = typeof import('../api/[id]/route')

let GET: DetailRoute['GET']
let features: string[]
let ownerUserId: string

const document = () => ({
  id: DOCUMENT_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  title: 'Capability document',
  folderId: null,
  ownerUserId,
  createdByUserId: USER_ID,
  isActive: true,
  createdAt: new Date('2026-07-10T10:00:00.000Z'),
  updatedAt: new Date('2026-07-10T10:00:00.000Z'),
  deletedAt: null,
})

const em = {
  find: jest.fn(async () => []),
  findOne: jest.fn(async (entity: unknown) => entity === Document ? document() : null),
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
  const route = await import('../api/[id]/route')
  GET = route.GET
})

beforeEach(() => {
  jest.clearAllMocks()
  features = ['documents.view']
  ownerUserId = USER_ID
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
})

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}`)
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('document detail capability aliases', () => {
  it('keeps legacy canShare equal to the projected action capability', async () => {
    features = ['documents.view', 'documents.share']

    const response = await GET(request(), context())
    const body = await response.json() as {
      canShare: boolean
      capabilities: { canShare: boolean; canEdit: boolean }
    }

    expect(response.status).toBe(200)
    expect(body.canShare).toBe(true)
    expect(body.canShare).toBe(body.capabilities.canShare)
    expect(body.capabilities.canEdit).toBe(false)
  })

  it('does not expose Share to a manager missing documents.share', async () => {
    ownerUserId = '55555555-5555-4555-8555-555555555555'
    features = ['documents.view', 'documents.manage']

    const response = await GET(request(), context())
    const body = await response.json() as {
      tier: string
      canShare: boolean
      capabilities: { canShare: boolean }
    }

    expect(response.status).toBe(200)
    expect(body.tier).toBe('owner')
    expect(body.canShare).toBe(false)
    expect(body.capabilities.canShare).toBe(false)
  })
})
