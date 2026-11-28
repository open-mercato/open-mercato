/** @jest-environment node */
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserRole, RoleAcl, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ROLE_SELF = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ROLE_TENANT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'

type World = { userOrgId: string | null; tenantRoleOrganizations: string[] | null; tenantRoleIsSuperAdmin: boolean }
const world: World = { userOrgId: null, tenantRoleOrganizations: [ORG_A], tenantRoleIsSuperAdmin: false }

const organizations = [
  { id: ORG_A, tenant: TENANT, ancestorIds: [], descendantIds: [] },
  { id: ORG_B, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

const em: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === ApiKey && where.id === KEY_ID) {
      return { id: KEY_ID, tenantId: TENANT, organizationId: null, rolesJson: [ROLE_SELF, ROLE_TENANT], expiresAt: null }
    }
    if (entity === User && where.id === USER_ID) return { id: USER_ID, tenantId: TENANT, organizationId: world.userOrgId }
    if (entity === UserAcl) return null
    return null
  }),
  find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === RoleAcl) {
      const tenantRoleAcl = {
        role: { id: ROLE_TENANT },
        tenantId: TENANT,
        isSuperAdmin: world.tenantRoleIsSuperAdmin,
        featuresJson: ['audit_logs.view_tenant'],
        organizationsJson: world.tenantRoleOrganizations,
      }
      if (where.isSuperAdmin === true) return world.tenantRoleIsSuperAdmin ? [tenantRoleAcl] : []
      return [
        { role: { id: ROLE_SELF }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['audit_logs.view_self'], organizationsJson: null },
        tenantRoleAcl,
      ]
    }
    if (entity === UserRole) return [{ role: { id: ROLE_SELF, tenantId: TENANT } }, { role: { id: ROLE_TENANT, tenantId: TENANT } }]
    if (entity === Organization) {
      const idFilter = (where.id as { $in?: string[] } | undefined)?.$in
      return organizations.filter((org) => !idFilter || idFilter.includes(org.id))
    }
    return []
  }),
}
em.fork.mockReturnValue(em)

const hierarchy = {
  resolveAncestorIds: jest.fn(async ({ organizationId }: { organizationId: string }) => (
    organizations.some((org) => org.id === organizationId) ? [] : null
  )),
}
let rbac = new RbacService(em as never, undefined, hierarchy as never)
const actionLogs = { list: jest.fn(async (_query: Record<string, unknown>) => ({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 })) }
const accessLogs = { list: jest.fn(async (_query: Record<string, unknown>) => ({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 })) }
const container = {
  resolve: (token: string) => {
    if (token === 'em') return em
    if (token === 'rbacService') return rbac
    if (token === 'actionLogService') return actionLogs
    if (token === 'accessLogService') return accessLogs
    throw new Error(`unregistered ${token}`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/core/modules/audit_logs/api/audit-logs/display', () => ({
  loadAuditLogDisplayMaps: jest.fn(async () => ({ users: {}, tenants: {}, organizations: {} })),
}))

import { GET as actionsGET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/route'
import { GET as exportGET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/export/route'
import { GET as accessGET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/access/route'

const apiKeyAuth = { sub: `api_key:${KEY_ID}`, tenantId: TENANT, orgId: null, roles: [], isApiKey: true, isSuperAdmin: false, keyId: KEY_ID }
const userAuth = (orgId: string | null) => ({ sub: USER_ID, tenantId: TENANT, orgId, roles: [], isSuperAdmin: false })

async function dispatcherCheck(auth: Record<string, unknown>, req: Request) {
  const requiredFeatures = ['audit_logs.view_self']
  const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: auth as never, request: req, requiredFeatures })
  const ok = await rbac.userHasAllFeatures(String(auth.sub), requiredFeatures, {
    tenantId: featureContext.scope.tenantId ?? (auth.tenantId as string) ?? null,
    organizationId: featureContext.organizationId,
  })
  return { ok, featureContext }
}

async function run(handler: (req: Request) => Promise<Response>, auth: Record<string, unknown>, url: string, cookie?: string) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue(auth)
  const req = new Request(url, { method: 'GET', headers: cookie ? { cookie } : {} })
  const gate = await dispatcherCheck(auth, req)
  if (!gate.ok) return { gate, status: 403 }
  const response = await handler(req)
  return { gate, status: response.status }
}

const lastActionQuery = () => actionLogs.list.mock.calls.at(-1)?.[0] ?? {}
const lastAccessQuery = () => accessLogs.list.mock.calls.at(-1)?.[0] ?? {}

const base = 'http://localhost/api/audit_logs/audit-logs'

describe('audit_logs.view_tenant applies to the organization being read', () => {
  beforeEach(() => {
    actionLogs.list.mockClear()
    accessLogs.list.mockClear()
    world.userOrgId = null
    world.tenantRoleOrganizations = [ORG_A]
    world.tenantRoleIsSuperAdmin = false
    rbac = new RbacService(em as never, undefined, hierarchy as never)
  })

  describe('API key without an organization, view_tenant granted for organization A only', () => {
    for (const [label, handler, path] of [
      ['actions', actionsGET, 'actions'],
      ['actions/export', exportGET, 'actions/export'],
    ] as const) {
      it(`${label}: a read without an organization returns the caller's own rows`, async () => {
        const result = await run(handler, apiKeyAuth, `${base}/${path}`)
        expect(result.status).toBe(200)
        const query = lastActionQuery()
        expect(query.organizationId).toBeUndefined()
        expect(query.actorSubject).toBe(apiKeyAuth.sub)
      })

      it(`${label}: organization A returns every actor`, async () => {
        const result = await run(handler, apiKeyAuth, `${base}/${path}?organizationId=${ORG_A}`)
        expect(result.status).toBe(200)
        const query = lastActionQuery()
        expect(query.organizationId).toBe(ORG_A)
        expect(query.actorSubject).toBeUndefined()
      })

      it(`${label}: organization B returns the caller's own rows`, async () => {
        const result = await run(handler, apiKeyAuth, `${base}/${path}?organizationId=${ORG_B}&actorUserId=${USER_ID}`)
        expect(result.status).toBe(200)
        const query = lastActionQuery()
        expect(query.organizationId).toBe(ORG_B)
        expect(query.actorSubject).toBe(apiKeyAuth.sub)
        expect(query.actorUserId).toBeUndefined()
      })
    }

    it('access: actorScope=all without an organization returns the caller\'s own rows', async () => {
      const result = await run(accessGET, apiKeyAuth, `${base}/access?actorScope=all`)
      expect(result.status).toBe(200)
      const query = lastAccessQuery()
      expect(query.organizationId).toBeUndefined()
      expect(query.actorUserId).toBe(apiKeyAuth.sub)
    })

    it('access: actorScope=all in organization A returns every actor', async () => {
      const result = await run(accessGET, apiKeyAuth, `${base}/access?actorScope=all&organizationId=${ORG_A}`)
      expect(result.status).toBe(200)
      const query = lastAccessQuery()
      expect(query.organizationId).toBe(ORG_A)
      expect(query.actorUserId).toBeUndefined()
    })
  })

  describe('user with home organization A, view_tenant granted for organization A only', () => {
    beforeEach(() => {
      world.userOrgId = ORG_A
    })

    for (const [label, handler, path] of [
      ['actions', actionsGET, 'actions'],
      ['actions/export', exportGET, 'actions/export'],
    ] as const) {
      it(`${label}: the home organization returns every actor`, async () => {
        const result = await run(handler, userAuth(ORG_A), `${base}/${path}`)
        expect(result.status).toBe(200)
        const query = lastActionQuery()
        expect(query.organizationId).toBe(ORG_A)
        expect(query.actorSubject).toBeUndefined()
      })

      it(`${label}: ?organizationId=B returns the caller's own rows`, async () => {
        const result = await run(handler, userAuth(ORG_A), `${base}/${path}?organizationId=${ORG_B}`)
        expect(result.status).toBe(200)
        const query = lastActionQuery()
        expect(query.organizationId).toBe(ORG_B)
        expect(query.actorSubject).toBe(USER_ID)
      })
    }

    it('access: ?organizationId=B with actorScope=all returns the caller\'s own rows', async () => {
      const result = await run(accessGET, userAuth(ORG_A), `${base}/access?actorScope=all&organizationId=${ORG_B}`)
      expect(result.status).toBe(200)
      const query = lastAccessQuery()
      expect(query.organizationId).toBe(ORG_B)
      expect(query.actorUserId).toBe(USER_ID)
    })
  })

  describe('super-admin role limited to organization A', () => {
    beforeEach(() => {
      world.tenantRoleIsSuperAdmin = true
    })

    const superAdminFlagged = { ...userAuth(null), isSuperAdmin: true }

    it('actions: a read without an organization returns the caller\'s own rows', async () => {
      const result = await run(actionsGET, superAdminFlagged, `${base}/actions`)
      expect(result.status).toBe(200)
      const query = lastActionQuery()
      expect(query.organizationId).toBeUndefined()
      expect(query.actorSubject).toBe(USER_ID)
    })

    it('access: actorScope=all without an organization returns the caller\'s own rows', async () => {
      const result = await run(accessGET, superAdminFlagged, `${base}/access?actorScope=all`)
      expect(result.status).toBe(200)
      expect(lastAccessQuery().actorUserId).toBe(USER_ID)
    })
  })

  it('does not consult RBAC for an organization id that is not a UUID', async () => {
    world.tenantRoleOrganizations = null
    world.userOrgId = ORG_A
    hierarchy.resolveAncestorIds.mockClear()
    const result = await run(accessGET, userAuth(ORG_A), `${base}/access?actorScope=all&organizationId=not-a-uuid`)
    expect(result.status).toBe(200)
    expect(hierarchy.resolveAncestorIds).not.toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'not-a-uuid' }))
    expect(lastAccessQuery().actorUserId).toBe(USER_ID)
  })

  describe('view_tenant granted without an organization restriction', () => {
    beforeEach(() => {
      world.tenantRoleOrganizations = null
    })

    it('actions: an API key without an organization still reads every actor of the tenant', async () => {
      const result = await run(actionsGET, apiKeyAuth, `${base}/actions`)
      expect(result.status).toBe(200)
      const query = lastActionQuery()
      expect(query.tenantId).toBe(TENANT)
      expect(query.organizationId).toBeUndefined()
      expect(query.actorSubject).toBeUndefined()
    })

    it('actions/export: a user reads every actor of another organization', async () => {
      world.userOrgId = ORG_A
      const result = await run(exportGET, userAuth(ORG_A), `${base}/actions/export?organizationId=${ORG_B}`)
      expect(result.status).toBe(200)
      const query = lastActionQuery()
      expect(query.organizationId).toBe(ORG_B)
      expect(query.actorSubject).toBeUndefined()
    })

    it('access: actorScope=all without an organization still reads every actor', async () => {
      const result = await run(accessGET, apiKeyAuth, `${base}/access?actorScope=all`)
      expect(result.status).toBe(200)
      expect(lastAccessQuery().actorUserId).toBeUndefined()
    })
  })
})
