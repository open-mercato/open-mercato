/** @jest-environment node */

import { User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const TARGET_USER_ID = '123e4567-e89b-12d3-a456-426614174050'
const RESTRICTED_FEATURE = 'directory.tenants.manage'

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  find: jest.fn(async () => []),
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

function putRequest(features: string[]) {
  return new Request('http://localhost/api/auth/users/acl', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: TARGET_USER_ID, features }),
  })
}

function commandInput(): { requested: { features: string[] } | null } {
  const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [
    string,
    { input: { requested: { features: string[] } | null } },
  ]
  return options.input
}

/**
 * `sanitizeTenantFeatures` trims restricted grants instead of refusing them, so
 * the write leaves the stored ACL identical and the audit entry would look like
 * any other no-op — and be skipped as one. The route therefore hands the
 * pre-sanitize request to the command, which records it and exempts the entry
 * from that guard.
 */
describe('user ACL sanitized-request reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: TENANT_ID, orgId: 'org-1' })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === User) return { id: TARGET_USER_ID, tenantId: TENANT_ID }
      if (ctor === UserAcl) return { id: 'acl-1', isSuperAdmin: false, featuresJson: ['catalog.view'] }
      return null
    })
  })

  it('reports what the caller asked for when a grant is trimmed away', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: false })

    const res = await PUT(putRequest(['catalog.view', RESTRICTED_FEATURE]))

    expect(res.status).toBe(200)
    expect(commandInput().requested).toEqual({ features: ['catalog.view', RESTRICTED_FEATURE] })
  })

  it('reports nothing when the request was applied as submitted', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: false })

    const res = await PUT(putRequest(['catalog.view']))

    expect(res.status).toBe(200)
    expect(commandInput().requested).toBeNull()
  })

  it('reports nothing for a super admin, whose request is never trimmed', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })

    const res = await PUT(putRequest(['catalog.view', RESTRICTED_FEATURE]))

    expect(res.status).toBe(200)
    expect(commandInput().requested).toBeNull()
  })
})
