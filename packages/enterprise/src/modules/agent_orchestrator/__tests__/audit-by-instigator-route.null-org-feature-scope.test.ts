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
const ORG_OUTSIDE = '99999999-9999-4999-8999-999999999999'
const KEY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const HUMAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ROLE_VISIBLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ROLE_IDENTITY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const FEATURE = 'agent_orchestrator.identity.read'

type World = { keyOrganizationId: string | null; identityRoleOrganizations: string[] | null }
const world: World = { keyOrganizationId: null, identityRoleOrganizations: [ORG_A] }

const organizations = [
  { id: ORG_A, tenant: TENANT, ancestorIds: [], descendantIds: [] },
  { id: ORG_B, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

const kyselyWheres: unknown[][] = []
const kyselyChain: Record<string, jest.Mock> = {}
for (const method of ['selectFrom', 'select', 'orderBy', 'limit']) kyselyChain[method] = jest.fn(() => kyselyChain)
kyselyChain.where = jest.fn((...args: unknown[]) => {
  kyselyWheres.push(args)
  return kyselyChain
})
kyselyChain.execute = jest.fn(async () => [])

const em: Record<string, jest.Mock> = {
  fork: jest.fn(),
  getKysely: jest.fn(() => kyselyChain),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === ApiKey && where.id === KEY_ID) {
      return { id: KEY_ID, tenantId: TENANT, organizationId: world.keyOrganizationId, rolesJson: [ROLE_VISIBLE, ROLE_IDENTITY], expiresAt: null }
    }
    if (entity === UserAcl || entity === User) return null
    return null
  }),
  find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === RoleAcl) {
      if (where.isSuperAdmin === true) return []
      return [
        { role: { id: ROLE_VISIBLE }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['dashboards.view'], organizationsJson: null },
        { role: { id: ROLE_IDENTITY }, tenantId: TENANT, isSuperAdmin: false, featuresJson: [FEATURE], organizationsJson: world.identityRoleOrganizations },
      ]
    }
    if (entity === UserRole) return []
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
const container = {
  resolve: (token: string) => {
    if (token === 'em') return em
    if (token === 'rbacService') return rbac
    throw new Error(`unregistered ${token}`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/lib/identity/actionAgentAttribution', () => ({
  resolveActionAgentAttribution: jest.fn(async () => []),
}))

import { GET } from '@open-mercato/enterprise/modules/agent_orchestrator/api/audit/by-instigator/[humanUserId]/route'

const apiKeyAuth = (orgId: string | null) => ({
  sub: `api_key:${KEY_ID}`, tenantId: TENANT, orgId, roles: [], isApiKey: true, isSuperAdmin: false, keyId: KEY_ID,
})

async function dispatch(auth: ReturnType<typeof apiKeyAuth>) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue(auth)
  const req = new Request(`http://localhost/api/agent_orchestrator/audit/by-instigator/${HUMAN}`)
  const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: auth as never, request: req, requiredFeatures: [FEATURE] })
  const ok = await rbac.userHasAllFeatures(auth.sub, [FEATURE], { tenantId: TENANT, organizationId: featureContext.organizationId })
  if (!ok) return { gateOk: false, status: 403, featureContext, body: null }
  const response = await GET(req, { params: Promise.resolve({ humanUserId: HUMAN }) })
  return { gateOk: true, status: response.status, featureContext, body: await response.json() }
}

function organizationPredicate(): string[] | null {
  const predicates = kyselyWheres.filter((args) => args[0] === 'action_logs.organization_id')
  if (predicates.length === 0) return null
  expect(predicates).toHaveLength(1)
  const [, operator, value] = predicates[0]
  if (operator === '=') return [value as string]
  if (operator === 'in') return value as string[]
  throw new Error(`unexpected operator ${String(operator)}`)
}

describe('GET /api/agent_orchestrator/audit/by-instigator/[humanUserId] organization scope', () => {
  beforeEach(() => {
    kyselyWheres.length = 0
    kyselyChain.execute.mockClear()
    world.keyOrganizationId = null
    world.identityRoleOrganizations = [ORG_A]
    rbac = new RbacService(em as never, undefined, hierarchy as never)
  })

  it('does not grant the feature at organization B', async () => {
    expect(await rbac.userHasAllFeatures(apiKeyAuth(null).sub, [FEATURE], { tenantId: TENANT, organizationId: ORG_B })).toBe(false)
  })

  it('pins the query to auth.orgId when the key has an organization', async () => {
    world.keyOrganizationId = ORG_A
    const result = await dispatch(apiKeyAuth(ORG_A))
    expect(result.gateOk).toBe(true)
    expect(result.status).toBe(200)
    expect(kyselyWheres).toContainEqual(['action_logs.organization_id', '=', ORG_A])
    expect(organizationPredicate()).toEqual([ORG_A])
  })

  it('limits a key without an organization to its single approved organization', async () => {
    const result = await dispatch(apiKeyAuth(null))
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.scope.filterIds).toEqual([ORG_A])
    expect(result.status).toBe(200)
    expect(kyselyWheres.map((args) => args[0])).toContain('action_logs.tenant_id')
    expect(organizationPredicate()).toEqual([ORG_A])
  })

  it('limits a key without an organization approved in two organizations to the first approved one', async () => {
    world.identityRoleOrganizations = [ORG_A, ORG_B]
    const result = await dispatch(apiKeyAuth(null))
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.scope.filterIds).toEqual([ORG_A, ORG_B])
    expect(result.featureContext.organizationId).toBe(ORG_A)
    expect(organizationPredicate()).toEqual([ORG_A])
  })

  it('returns an empty result without querying when no organization is approved', async () => {
    world.identityRoleOrganizations = [ORG_OUTSIDE]
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(apiKeyAuth(null))
    const req = new Request(`http://localhost/api/agent_orchestrator/audit/by-instigator/${HUMAN}`)
    const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: apiKeyAuth(null) as never, request: req, requiredFeatures: [FEATURE] })
    expect(featureContext.organizationId).toBeNull()
    expect(featureContext.scope.filterIds).toEqual([])

    const response = await GET(req, { params: Promise.resolve({ humanUserId: HUMAN }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ humanUserId: HUMAN, items: [], total: 0 })
    expect(kyselyChain.execute).not.toHaveBeenCalled()
  })

  it('keeps a tenant-wide key without an organization unrestricted', async () => {
    world.identityRoleOrganizations = null
    const result = await dispatch(apiKeyAuth(null))
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.organizationId).toBeNull()
    expect(result.featureContext.scope.filterIds).toBeNull()
    expect(organizationPredicate()).toBeNull()
  })
})
