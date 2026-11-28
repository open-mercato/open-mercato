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
const ROLE_VISIBLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ROLE_ENTITIES = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const ENTITY_ID = 'example:secret_thing'

const classification = { kind: 'custom' as const, restricted: false }

type World = { entitiesRoleOrganizations: string[] | null }
const world: World = { entitiesRoleOrganizations: [ORG_A] }

const organizations = [
  { id: ORG_A, tenant: TENANT, ancestorIds: [], descendantIds: [] },
  { id: ORG_B, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

const em: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === ApiKey && where.id === KEY_ID) {
      return { id: KEY_ID, tenantId: TENANT, organizationId: null, rolesJson: [ROLE_VISIBLE, ROLE_ENTITIES], expiresAt: null }
    }
    if (entity === UserAcl || entity === User) return null
    return null
  }),
  find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === RoleAcl) {
      if (where.isSuperAdmin === true) return []
      return [
        { role: { id: ROLE_VISIBLE }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['dashboards.view'], organizationsJson: null },
        {
          role: { id: ROLE_ENTITIES },
          tenantId: TENANT,
          isSuperAdmin: false,
          featuresJson: ['entities.records.view', 'entities.records.manage', `entities.records.${ENTITY_ID}.view`],
          organizationsJson: world.entitiesRoleOrganizations,
        },
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
const queryEngine = { query: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })) }
const container = {
  resolve: (token: string) => {
    if (token === 'em') return em
    if (token === 'rbacService') return rbac
    if (token === 'queryEngine') return queryEngine
    throw new Error(`unregistered ${token}`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/core/modules/entities/lib/entityClassification', () => ({
  classifyRecordsEntity: jest.fn(async () => classification),
}))
jest.mock('@open-mercato/core/modules/entities/lib/scoped-field-defs', () => ({
  loadCustomFieldKinds: jest.fn(async () => new Map()),
}))

import { GET } from '@open-mercato/core/modules/entities/api/records'

const apiKeyAuth = { sub: `api_key:${KEY_ID}`, tenantId: TENANT, orgId: null, roles: [], isApiKey: true, isSuperAdmin: false, keyId: KEY_ID }

async function dispatch(url: string, feature: string) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue(apiKeyAuth)
  const req = new Request(url)
  const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: apiKeyAuth as never, request: req, requiredFeatures: [feature] })
  const ok = await rbac.userHasAllFeatures(apiKeyAuth.sub, [feature], { tenantId: TENANT, organizationId: featureContext.organizationId })
  if (!ok) return { gateOk: false, status: 403, featureContext }
  const response = await GET(req)
  return { gateOk: true, status: response.status, featureContext }
}

const lastQueryOptions = () => (queryEngine.query.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>

describe('GET /api/entities/records for a tenant-level API key without an organization', () => {
  beforeEach(() => {
    queryEngine.query.mockClear()
    classification.restricted = false
    world.entitiesRoleOrganizations = [ORG_A]
    rbac = new RbacService(em as never, undefined, hierarchy as never)
  })

  it('does not grant the records features at organization B to a key restricted to A', async () => {
    expect(await rbac.userHasAllFeatures(apiKeyAuth.sub, ['entities.records.view'], { tenantId: TENANT, organizationId: ORG_B })).toBe(false)
    expect(await rbac.userHasAllFeatures(apiKeyAuth.sub, [`entities.records.${ENTITY_ID}.view`], { tenantId: TENANT, organizationId: ORG_B })).toBe(false)
  })

  it('filters an unrestricted custom entity to organization A', async () => {
    const result = await dispatch(`http://localhost/api/entities/records?entityId=${ENTITY_ID}`, 'entities.records.view')
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.scope.filterIds).toEqual([ORG_A])
    expect(result.status).toBe(200)
    const opts = lastQueryOptions()
    expect(opts.tenantId).toBe(TENANT)
    expect(opts.organizationIds).toEqual([ORG_A])
    expect((opts.filters as Record<string, unknown>).organization_id).toEqual({ $in: [ORG_A] })
  })

  it('filters a restricted custom entity to organization A', async () => {
    classification.restricted = true
    const result = await dispatch(`http://localhost/api/entities/records?entityId=${ENTITY_ID}`, 'entities.records.view')
    expect(result.status).toBe(200)
    const opts = lastQueryOptions()
    expect(opts.organizationIds).toEqual([ORG_A])
    expect((opts.filters as Record<string, unknown>).organization_id).toEqual({ $in: [ORG_A] })
  })

  it('keeps a tenant-wide query for a key whose records role is not organization-restricted', async () => {
    world.entitiesRoleOrganizations = null
    const result = await dispatch(`http://localhost/api/entities/records?entityId=${ENTITY_ID}`, 'entities.records.view')
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.scope.filterIds).toBeNull()
    expect(result.status).toBe(200)
    const opts = lastQueryOptions()
    expect(opts.tenantId).toBe(TENANT)
    expect(opts.organizationIds).toBeUndefined()
    expect((opts.filters as Record<string, unknown>).organization_id).toBeUndefined()
  })
})
