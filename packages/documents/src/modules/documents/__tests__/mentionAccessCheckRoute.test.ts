import { Document, DocumentShare } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const OWNER_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const DIRECT_USER_ID = '66666666-6666-4666-8666-666666666666'
const ROLE_USER_ID = '77777777-7777-4777-8777-777777777777'
const MANAGER_USER_ID = '88888888-8888-4888-8888-888888888888'
const MISSING_USER_ID = '99999999-9999-4999-8999-999999999999'
const ROLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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

type AccessCheckRoute = typeof import('../api/[id]/comments/access-check/route')
type ShareRow = {
  principalType: 'user' | 'role'
  principalId: string
  permission: 'viewer' | 'commenter' | 'editor'
}

let POST: AccessCheckRoute['POST']
let actorTier: ShareRow['permission']
let shares: ShareRow[]
let em: { findOne: jest.Mock; find: jest.Mock }

function principalMatches(share: ShareRow, filter: Record<string, unknown>): boolean {
  if (filter.principalType !== share.principalType) return false
  if (typeof filter.principalId === 'string') return filter.principalId === share.principalId
  const idFilter = filter.principalId as { $in?: unknown } | null
  return Array.isArray(idFilter?.$in) && idFilter.$in.includes(share.principalId)
}

const rbacService = {
  loadAcl: jest.fn(async () => ({
    isSuperAdmin: false,
    features: ['documents.view'],
    organizations: null,
  })),
  userHasAllFeatures: jest.fn(async (userId: string, features: string[]) => (
    userId === MANAGER_USER_ID && features.includes('documents.manage')
  )),
}

const authPrincipalService = {
  principalExists: jest.fn(async () => true),
  resolveLabels: jest.fn(async () => []),
  listSuperAdminUserIds: jest.fn(async () => []),
  resolveActiveUserRoleIds: jest.fn(async (userId: string) => userId === ROLE_USER_ID ? [ROLE_ID] : []),
  filterActiveRoleIds: jest.fn(async (roleIds: string[]) => roleIds),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'authPrincipalService') return authPrincipalService
    return undefined
  }),
}

beforeAll(async () => {
  POST = (await import('../api/[id]/comments/access-check/route')).POST
})

beforeEach(() => {
  jest.clearAllMocks()
  actorTier = 'commenter'
  shares = [
    { principalType: 'user', principalId: DIRECT_USER_ID, permission: 'viewer' },
    { principalType: 'role', principalId: ROLE_ID, permission: 'viewer' },
  ]
  em = {
    findOne: jest.fn(async (entity: unknown) => entity === Document ? {
      id: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      ownerUserId: OWNER_ID,
      deletedAt: null,
    } : null),
    find: jest.fn(async (entity: unknown, where: unknown) => {
      if (entity !== DocumentShare) return []
      const query = where as { $or?: Array<Record<string, unknown>> }
      const actorShare: ShareRow = {
        principalType: 'user',
        principalId: ACTOR_ID,
        permission: actorTier,
      }
      return [actorShare, ...shares].filter((share) => (
        query.$or?.some((filter) => principalMatches(share, filter)) ?? false
      ))
    }),
  }
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: ACTOR_ID,
    userId: ACTOR_ID,
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

function request(userIds: string[]): Request {
  return new Request(
    `http://localhost/api/documents/${DOCUMENT_ID}/comments/access-check`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userIds }),
    },
  )
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('document mention access check', () => {
  it('denies a document viewer before resolving mentioned-user membership', async () => {
    actorTier = 'viewer'

    const response = await POST(request([DIRECT_USER_ID]), context())

    expect(response.status).toBe(403)
    expect(authPrincipalService.resolveActiveUserRoleIds).not.toHaveBeenCalledWith(DIRECT_USER_ID, expect.anything())
  })

  it('recognizes direct, role, owner, and live manage access without returning identity data', async () => {
    const response = await POST(request([
      DIRECT_USER_ID,
      ROLE_USER_ID,
      OWNER_ID,
      MANAGER_USER_ID,
      MISSING_USER_ID,
    ]), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      withoutAccess: [MISSING_USER_ID],
      withoutAccessUsers: [{ userId: MISSING_USER_ID, label: null, secondary: null }],
    })
    expect(rbacService.userHasAllFeatures).toHaveBeenCalledWith(
      MANAGER_USER_ID,
      ['documents.manage'],
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )
  })
})
