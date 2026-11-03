import { Document } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555'
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
let deletedAt: Date | null
let exists: boolean

const document = () => ({
  id: DOCUMENT_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  title: 'Removed document',
  folderId: null,
  ownerUserId,
  createdByUserId: ownerUserId,
  isActive: true,
  createdAt: new Date('2026-07-10T10:00:00.000Z'),
  updatedAt: new Date('2026-07-10T10:00:00.000Z'),
  deletedAt,
})

function matchesDeletedAt(where: Record<string, unknown>): boolean {
  if (!('deletedAt' in where)) return true
  const condition = where.deletedAt
  if (condition === null) return deletedAt === null
  if (condition && typeof condition === 'object' && '$ne' in condition) return deletedAt !== null
  return false
}

const em = {
  find: jest.fn(async () => []),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (
    exists && entity === Document && matchesDeletedAt(where) ? document() : null
  )),
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
  deletedAt = new Date('2026-07-10T10:05:00.000Z')
  exists = true
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

describe('document detail for a removed document', () => {
  it('answers 404 to the owner once the document was removed (e.g. its creation was undone)', async () => {
    const response = await GET(request(), context())

    expect(response.status).toBe(404)
  })

  it('answers 404 to a documents manager for a removed document they do not own', async () => {
    ownerUserId = OTHER_USER_ID
    features = ['documents.view', 'documents.manage']

    const response = await GET(request(), context())

    expect(response.status).toBe(404)
  })

  it('keeps 403 for a removed document owned by someone else so removal is not disclosed', async () => {
    ownerUserId = OTHER_USER_ID

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
  })

  it('keeps 403 for an unknown document id', async () => {
    exists = false

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
  })

  it('still serves the live document to its owner', async () => {
    deletedAt = null

    const response = await GET(request(), context())

    expect(response.status).toBe(200)
  })
})
