/** @jest-environment node */

import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174050'
const ACL_ID = '123e4567-e89b-12d3-a456-426614174060'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockGetAuthFromRequest = jest.fn()
const mockResolveIsSuperAdmin = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn().mockReturnThis(),
  flush: jest.fn(),
  begin: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
}

const mockRbacService = {
  loadAcl: jest.fn(),
  invalidateTenantCache: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'cache') return {}
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

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn((args: unknown) => mockResolveIsSuperAdmin(args)),
}))

jest.mock('@open-mercato/core/modules/auth/lib/grantChecks', () => ({
  assertActorCanGrantAcl: jest.fn(async () => undefined),
  assertActorCanModifySuperAdminRoleTarget: jest.fn(async () => undefined),
  normalizeGrantFeatureList: (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
}))

function putRequest(headerVersion: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request('http://localhost/api/auth/roles/acl', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ roleId: ROLE_ID, features: ['catalog.view'] }),
  })
}

describe('role ACL optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: 'org-1' })
    mockResolveIsSuperAdmin.mockResolvedValue(true)
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === Role) return { id: ROLE_ID, tenantId: TENANT_ID }
      if (ctor === RoleAcl) {
        return {
          id: ACL_ID,
          isSuperAdmin: false,
          featuresJson: ['catalog.view'],
          organizationsJson: null,
          updatedAt: new Date(CURRENT_VERSION),
        }
      }
      return null
    })
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PUT(putRequest(STALE_VERSION))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.commit).not.toHaveBeenCalled()
  })

  it('persists inside a transaction when the expected version matches', async () => {
    const res = await PUT(putRequest(CURRENT_VERSION))
    expect(res.status).toBe(200)
    expect(mockEm.begin).toHaveBeenCalledTimes(1)
    expect(mockEm.commit).toHaveBeenCalledTimes(1)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) when the client sends no expected-version header (strictly additive)', async () => {
    const res = await PUT(putRequest(null))
    expect(res.status).toBe(200)
    expect(mockEm.commit).toHaveBeenCalledTimes(1)
  })
})
