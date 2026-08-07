/** @jest-environment node */

import { User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { PUT } from '../route'

const ACTOR_TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const TARGET_TENANT_ID = '123e4567-e89b-12d3-a456-426614174077'
const TARGET_USER_ID = '123e4567-e89b-12d3-a456-426614174050'

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  flush: jest.fn(),
  begin: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
}

const mockRbacService = {
  loadAcl: jest.fn(),
  invalidateUserCache: jest.fn(),
}

const mockCommandBus = { execute: jest.fn(async () => ({ result: null, logEntry: null })) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'cache') return {}
    if (token === 'commandBus') return mockCommandBus
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  logCrudAccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/auth/lib/grantChecks', () => ({
  assertActorCanAccessUserTarget: jest.fn(async () => undefined),
  assertActorCanGrantAcl: jest.fn(async () => undefined),
  assertActorCanModifySuperAdminUserTarget: jest.fn(async () => undefined),
  normalizeGrantFeatureList: (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
}))

function putRequest() {
  return new Request('http://localhost/api/auth/users/acl', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: TARGET_USER_ID, features: ['catalog.view'] }),
  })
}

function wireEm(options: { targetUserTenantId: string | null; existingAcl?: unknown }) {
  mockEm.findOne.mockImplementation(async (ctor: unknown) => {
    if (ctor === User) return { id: TARGET_USER_ID, tenantId: options.targetUserTenantId }
    if (ctor === UserAcl) return options.existingAcl ?? null
    return null
  })
}

/**
 * `user_acls.tenant_id` is NOT NULL, but `users.tenant_id` is nullable, so a
 * global account logs in with `auth.tenantId === null`. The route previously ran
 * the ACL lookup with an undefined tenant predicate — MikroORM drops it, so the
 * update and clear paths matched whichever row existed in any tenant, and the
 * create path hit a NOT NULL violation.
 *
 * Scope now resolves actor-tenant first, then the target user's, mirroring the
 * role ACL route, and only refuses when neither exists.
 */
describe('user ACL tenant resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })
  })

  it('uses the actor tenant when present', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-1' })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [string, { input: { tenantId: string } }]
    expect(options.input.tenantId).toBe(ACTOR_TENANT_ID)
  })

  it('falls back to the target user tenant for a tenant-less actor', async () => {
    // A global account could previously edit or clear an override through the
    // unscoped lookup; that capability is preserved, now correctly scoped.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: null })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [string, { input: { tenantId: string } }]
    expect(options.input.tenantId).toBe(TARGET_TENANT_ID)

    // The ACL lookup must carry a concrete tenant, never an undefined predicate.
    const aclLookup = mockEm.findOne.mock.calls.find(([ctor]) => ctor === UserAcl)
    expect(aclLookup?.[1]).toMatchObject({ tenantId: TARGET_TENANT_ID })
  })

  it('refuses only when neither the actor nor the target has a tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: null })
    wireEm({ targetUserTenantId: null })

    const res = await PUT(putRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Tenant required')
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})
