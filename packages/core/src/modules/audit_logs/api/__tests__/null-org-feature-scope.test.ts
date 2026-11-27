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
const ROLE_VISIBLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ROLE_AUDIT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'

type World = { userOrgId: string | null; auditRoleOrganizations: string[] | null }
const world: World = { userOrgId: null, auditRoleOrganizations: [ORG_A] }

const organizations = [
  { id: ORG_A, tenant: TENANT, ancestorIds: [], descendantIds: [] },
  { id: ORG_B, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

const em: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === ApiKey && where.id === KEY_ID) {
      return { id: KEY_ID, tenantId: TENANT, organizationId: null, rolesJson: [ROLE_VISIBLE, ROLE_AUDIT], expiresAt: null }
    }
    if (entity === User && where.id === USER_ID) return { id: USER_ID, tenantId: TENANT, organizationId: world.userOrgId }
    if (entity === UserAcl) return null
    return null
  }),
  find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === RoleAcl) {
      if (where.isSuperAdmin === true) return []
      return [
        { role: { id: ROLE_VISIBLE }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['dashboards.view'], organizationsJson: null },
        {
          role: { id: ROLE_AUDIT },
          tenantId: TENANT,
          isSuperAdmin: false,
          featuresJson: ['audit_logs.view_self', 'audit_logs.view_tenant'],
          organizationsJson: world.auditRoleOrganizations,
        },
      ]
    }
    if (entity === UserRole) return [{ role: { id: ROLE_VISIBLE, tenantId: TENANT } }, { role: { id: ROLE_AUDIT, tenantId: TENANT } }]
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

describe('audit log reads for a principal without an organization whose audit role is restricted', () => {
  beforeEach(() => {
    actionLogs.list.mockClear()
    accessLogs.list.mockClear()
    world.userOrgId = null
    world.auditRoleOrganizations = [ORG_A]
    rbac = new RbacService(em as never, undefined, hierarchy as never)
  })

  for (const [label, makeAuth] of [
    ['tenant-level API key restricted to organization A', () => apiKeyAuth],
    ['user without a home organization restricted to organization A', () => userAuth(null)],
  ] as const) {
    describe(label, () => {
      it('anchors the dispatcher gate to organization A', async () => {
        const req = new Request('http://localhost/api/audit_logs/audit-logs/actions')
        const { ok, featureContext } = await dispatcherCheck(makeAuth(), req)
        expect(ok).toBe(true)
        expect(featureContext.organizationId).toBe(ORG_A)
        expect(featureContext.scope.allowedIds).toEqual([ORG_A])
        expect(featureContext.scope.filterIds).toEqual([ORG_A])
      })

      it('actions: queries organization A only', async () => {
        const result = await run(actionsGET, makeAuth(), 'http://localhost/api/audit_logs/audit-logs/actions')
        expect(result.status).toBe(200)
        const query = lastActionQuery()
        expect(query.tenantId).toBe(TENANT)
        expect(query.organizationId).toBe(ORG_A)
        expect(query.actorSubject).toBeUndefined()
      })

      it('actions: ?organizationId=A stays on A and ?organizationId=B is ignored', async () => {
        await run(actionsGET, makeAuth(), `http://localhost/api/audit_logs/audit-logs/actions?organizationId=${ORG_A}`)
        expect(lastActionQuery().organizationId).toBe(ORG_A)
        await run(actionsGET, makeAuth(), `http://localhost/api/audit_logs/audit-logs/actions?organizationId=${ORG_B}`)
        expect(lastActionQuery().organizationId).toBe(ORG_A)
      })

      it('export: queries organization A only, and ignores ?organizationId=B', async () => {
        const result = await run(exportGET, makeAuth(), 'http://localhost/api/audit_logs/audit-logs/actions/export')
        expect(result.status).toBe(200)
        expect(lastActionQuery().organizationId).toBe(ORG_A)
        expect(lastActionQuery().actorSubject).toBeUndefined()
        await run(exportGET, makeAuth(), `http://localhost/api/audit_logs/audit-logs/actions/export?organizationId=${ORG_A}`)
        expect(lastActionQuery().organizationId).toBe(ORG_A)
        await run(exportGET, makeAuth(), `http://localhost/api/audit_logs/audit-logs/actions/export?organizationId=${ORG_B}`)
        expect(lastActionQuery().organizationId).toBe(ORG_A)
      })

      it('access: the self read and actorScope=all both query organization A only', async () => {
        const auth = makeAuth()
        await run(accessGET, auth, 'http://localhost/api/audit_logs/audit-logs/access')
        expect(lastAccessQuery().organizationId).toBe(ORG_A)
        expect(lastAccessQuery().actorUserId).toBe(auth.sub)
        await run(accessGET, auth, 'http://localhost/api/audit_logs/audit-logs/access?actorScope=all')
        expect(lastAccessQuery().organizationId).toBe(ORG_A)
        expect(lastAccessQuery().actorUserId).toBeUndefined()
        await run(accessGET, auth, `http://localhost/api/audit_logs/audit-logs/access?organizationId=${ORG_B}`)
        expect(lastAccessQuery().organizationId).toBe(ORG_A)
      })
    })
  }

  describe('controls', () => {
    it('tenant-level API key whose audit role is not organization-restricted still reads tenant-wide', async () => {
      world.auditRoleOrganizations = null
      const result = await run(actionsGET, apiKeyAuth, 'http://localhost/api/audit_logs/audit-logs/actions')
      expect(result.status).toBe(200)
      expect(result.gate.featureContext.organizationId).toBeNull()
      expect(result.gate.featureContext.scope.filterIds).toBeNull()
      expect(result.gate.featureContext.scope.allowedIds).toBeNull()
      expect(lastActionQuery().tenantId).toBe(TENANT)
      expect(lastActionQuery().organizationId).toBeUndefined()
      await run(actionsGET, apiKeyAuth, `http://localhost/api/audit_logs/audit-logs/actions?organizationId=${ORG_B}`)
      expect(lastActionQuery().organizationId).toBe(ORG_B)
    })

    it('user with home org B (outside A) and the all-organizations selection is denied at the gate', async () => {
      world.userOrgId = ORG_B
      const result = await run(actionsGET, userAuth(ORG_B), 'http://localhost/api/audit_logs/audit-logs/actions', 'om_selected_org=__all__')
      expect(result.gate.featureContext.organizationId).toBe(ORG_B)
      expect(result.gate.featureContext.scope.allowedIds).toEqual([ORG_A])
      expect(result.status).toBe(403)
      expect(actionLogs.list).not.toHaveBeenCalled()
    })

    it('user with home org A and the all-organizations selection is scoped to A', async () => {
      world.userOrgId = ORG_A
      const result = await run(actionsGET, userAuth(ORG_A), 'http://localhost/api/audit_logs/audit-logs/actions', 'om_selected_org=__all__')
      expect(result.status).toBe(200)
      expect(lastActionQuery().organizationId).toBe(ORG_A)
    })
  })
})
