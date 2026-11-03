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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
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

function partialPutRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/users/acl', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: TARGET_USER_ID, ...body }),
  })
}

function commandInput(): { requested: { features: string[] } | null } {
  const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [
    string,
    { input: { requested: { features: string[] } | null } },
  ]
  return options.input
}

function commandAclInput(): {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
  clear: boolean
} {
  const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [
    string,
    {
      input: {
        isSuperAdmin: boolean
        features: string[]
        organizations: string[] | null
        clear: boolean
      }
    },
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
      if (ctor === UserAcl) {
        return {
          id: 'acl-1',
          isSuperAdmin: false,
          featuresJson: ['catalog.view'],
          organizationsJson: ['org-existing'],
        }
      }
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

  it('preserves stored features when an organization-only update is submitted', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })

    const res = await PUT(partialPutRequest({ organizations: ['org-next'] }))

    expect(res.status).toBe(200)
    expect(commandAclInput()).toMatchObject({
      isSuperAdmin: false,
      features: ['catalog.view'],
      organizations: ['org-next'],
      clear: false,
    })
  })

  it('preserves the stored organization restriction when only features change', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })

    const res = await PUT(partialPutRequest({ features: ['sales.orders.view'] }))

    expect(res.status).toBe(200)
    expect(commandAclInput()).toMatchObject({
      features: ['sales.orders.view'],
      organizations: ['org-existing'],
      clear: false,
    })
  })

  it('rejects an organization-only ACL when no override exists yet', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === User) return { id: TARGET_USER_ID, tenantId: TENANT_ID }
      return null
    })

    const res = await PUT(partialPutRequest({ organizations: ['org-next'] }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'Organization restrictions require at least one feature override. Add a feature or module wildcard, or clear the organization scope before saving.',
    })
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it('clears every ACL dimension when organizations is an empty array', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })

    const res = await PUT(partialPutRequest({
      isSuperAdmin: false,
      features: [],
      organizations: [],
    }))

    expect(res.status).toBe(200)
    expect(commandAclInput()).toMatchObject({
      isSuperAdmin: false,
      features: [],
      organizations: [],
      clear: true,
    })
  })

  it('persists an empty organization scope when a feature override remains', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })

    const res = await PUT(partialPutRequest({
      isSuperAdmin: false,
      features: ['catalog.view'],
      organizations: [],
    }))

    expect(res.status).toBe(200)
    expect(commandAclInput()).toMatchObject({
      isSuperAdmin: false,
      features: ['catalog.view'],
      organizations: [],
      clear: false,
    })
  })

  it('preserves stored super admin access when the field is omitted', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === User) return { id: TARGET_USER_ID, tenantId: TENANT_ID }
      if (ctor === UserAcl) {
        return {
          id: 'acl-1',
          isSuperAdmin: true,
          featuresJson: [],
          organizationsJson: null,
        }
      }
      return null
    })

    const res = await PUT(partialPutRequest({ features: ['catalog.view'] }))

    expect(res.status).toBe(200)
    expect(commandAclInput()).toMatchObject({
      isSuperAdmin: true,
      features: ['catalog.view'],
      organizations: null,
      clear: false,
    })
  })

  it('explicitly revokes super admin access and clears every ACL dimension', async () => {
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === User) return { id: TARGET_USER_ID, tenantId: TENANT_ID }
      if (ctor === UserAcl) {
        return {
          id: 'acl-1',
          isSuperAdmin: true,
          featuresJson: ['catalog.view'],
          organizationsJson: ['org-existing'],
        }
      }
      return null
    })

    const res = await PUT(partialPutRequest({
      isSuperAdmin: false,
      features: [],
      organizations: null,
    }))

    expect(res.status).toBe(200)
    expect(commandAclInput()).toMatchObject({
      isSuperAdmin: false,
      features: [],
      organizations: null,
      clear: true,
    })
  })
})
