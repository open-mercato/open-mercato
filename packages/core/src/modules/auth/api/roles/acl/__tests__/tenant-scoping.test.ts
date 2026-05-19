/** @jest-environment node */

import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { GET, PUT } from '../route'

const ACTOR_TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const FOREIGN_TENANT_ID = '123e4567-e89b-12d3-a456-426614174099'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174050'

const mockGetAuthFromRequest = jest.fn()
const mockResolveIsSuperAdmin = jest.fn()
const mockLogCrudAccess = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn().mockReturnThis(),
  flush: jest.fn(),
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
  logCrudAccess: jest.fn((args: unknown) => mockLogCrudAccess(args)),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn((args: unknown) =>
    mockResolveIsSuperAdmin(args),
  ),
}))

describe('role ACL tenant scoping — existence oracle prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: ACTOR_TENANT_ID,
      orgId: 'org-1',
    })
    mockResolveIsSuperAdmin.mockResolvedValue(false)
    mockLogCrudAccess.mockResolvedValue(undefined)
    mockRbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: [],
    })
  })

  it('GET returns 404 for a role belonging to another tenant (not 403)', async () => {
    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === Role && where.id === ROLE_ID && !where.$or) {
          return { id: ROLE_ID, tenantId: FOREIGN_TENANT_ID }
        }
        return null
      },
    )

    const res = await GET(
      new Request(
        `http://localhost/api/auth/roles/acl?roleId=${ROLE_ID}`,
      ),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('GET scopes role lookup to own tenant for non-superadmin', async () => {
    mockEm.findOne.mockResolvedValue(null)

    await GET(
      new Request(
        `http://localhost/api/auth/roles/acl?roleId=${ROLE_ID}`,
      ),
    )

    expect(mockEm.findOne).toHaveBeenCalledWith(
      Role,
      expect.objectContaining({
        id: ROLE_ID,
        $or: [{ tenantId: ACTOR_TENANT_ID }, { tenantId: null }],
      }),
    )
  })

  it('GET does not scope by tenant for superadmin', async () => {
    mockResolveIsSuperAdmin.mockResolvedValue(true)
    mockEm.findOne.mockResolvedValue({
      id: ROLE_ID,
      tenantId: FOREIGN_TENANT_ID,
    })

    const res = await GET(
      new Request(
        `http://localhost/api/auth/roles/acl?roleId=${ROLE_ID}`,
      ),
    )

    expect(res.status).toBe(200)
    expect(mockEm.findOne).toHaveBeenCalledWith(
      Role,
      expect.objectContaining({ id: ROLE_ID }),
    )
    const roleFilter = mockEm.findOne.mock.calls[0][1] as Record<
      string,
      unknown
    >
    expect(roleFilter.$or).toBeUndefined()
  })

  it('PUT returns 404 for a role belonging to another tenant (not 403)', async () => {
    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === Role && where.id === ROLE_ID && !where.$or) {
          return { id: ROLE_ID, tenantId: FOREIGN_TENANT_ID }
        }
        return null
      },
    )

    const res = await PUT(
      new Request('http://localhost/api/auth/roles/acl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleId: ROLE_ID,
          features: ['some.feature'],
        }),
      }),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('GET allows access to system roles (null tenantId)', async () => {
    const systemRole = { id: ROLE_ID, tenantId: null }
    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === Role && where.$or) return systemRole
        return null
      },
    )

    const res = await GET(
      new Request(
        `http://localhost/api/auth/roles/acl?roleId=${ROLE_ID}`,
      ),
    )

    expect(res.status).toBe(200)
  })

  it('PUT rejects feature grants outside the actor effective ACL', async () => {
    const role = { id: ROLE_ID, tenantId: ACTOR_TENANT_ID }
    mockRbacService.loadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.acl.manage'],
      organizations: null,
    })
    mockEm.findOne.mockImplementation(
      async (ctor: unknown) => {
        if (ctor === Role) return role
        if (ctor === RoleAcl) {
          return {
            role,
            tenantId: ACTOR_TENANT_ID,
            isSuperAdmin: false,
            featuresJson: ['auth.acl.manage'],
            organizationsJson: null,
          }
        }
        return null
      },
    )

    const res = await PUT(
      new Request('http://localhost/api/auth/roles/acl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleId: ROLE_ID,
          features: ['auth.acl.manage', 'api_keys.create'],
        }),
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('Cannot grant feature api_keys.create')
    expect(mockEm.persist).not.toHaveBeenCalled()
  })

  it('PUT rejects superadmin grants from non-superadmin actors', async () => {
    const role = { id: ROLE_ID, tenantId: ACTOR_TENANT_ID }
    mockRbacService.loadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.acl.manage'],
      organizations: null,
    })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === Role) return role
      if (ctor === RoleAcl) {
        return {
          role,
          tenantId: ACTOR_TENANT_ID,
          isSuperAdmin: false,
          featuresJson: ['auth.acl.manage'],
          organizationsJson: null,
        }
      }
      return null
    })

    const res = await PUT(
      new Request('http://localhost/api/auth/roles/acl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleId: ROLE_ID,
          isSuperAdmin: true,
          features: ['auth.acl.manage'],
        }),
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('super admin')
    expect(mockEm.persist).not.toHaveBeenCalled()
  })

  it('PUT rejects global wildcard grants from non-superadmin actors', async () => {
    const role = { id: ROLE_ID, tenantId: ACTOR_TENANT_ID }
    mockRbacService.loadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.acl.manage'],
      organizations: null,
    })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === Role) return role
      if (ctor === RoleAcl) {
        return {
          role,
          tenantId: ACTOR_TENANT_ID,
          isSuperAdmin: false,
          featuresJson: ['auth.acl.manage'],
          organizationsJson: null,
        }
      }
      return null
    })

    const res = await PUT(
      new Request('http://localhost/api/auth/roles/acl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleId: ROLE_ID,
          features: ['*'],
        }),
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('global wildcard')
    expect(mockEm.persist).not.toHaveBeenCalled()
  })

  it('PUT rejects organization grants outside the actor scope', async () => {
    const role = { id: ROLE_ID, tenantId: ACTOR_TENANT_ID }
    mockRbacService.loadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.acl.manage'],
      organizations: ['org-allowed'],
    })
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === Role) return role
      if (ctor === RoleAcl) {
        return {
          role,
          tenantId: ACTOR_TENANT_ID,
          isSuperAdmin: false,
          featuresJson: ['auth.acl.manage'],
          organizationsJson: ['org-allowed'],
        }
      }
      return null
    })

    const res = await PUT(
      new Request('http://localhost/api/auth/roles/acl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleId: ROLE_ID,
          features: ['auth.acl.manage'],
          organizations: ['org-denied'],
        }),
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('organization access outside actor scope')
    expect(mockEm.persist).not.toHaveBeenCalled()
  })
})
