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
const ROLE_VISIBLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ROLE_SEARCH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'

type World = { searchRoleOrganizations: string[] | null }
const world: World = { searchRoleOrganizations: [ORG_A] }

const organizations = [
  { id: ORG_A, tenant: TENANT, ancestorIds: [], descendantIds: [] },
  { id: ORG_B, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

type IndexEntry = { id: string; organizationId: string }
const indexedEntries: IndexEntry[] = [
  { id: 'a1', organizationId: ORG_A },
  { id: 'a2', organizationId: ORG_A },
  { id: 'a3', organizationId: ORG_A },
  { id: 'b1', organizationId: ORG_B },
  { id: 'b2', organizationId: ORG_B },
  { id: 'b3', organizationId: ORG_B },
]

const em: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === ApiKey && where.id === KEY_ID) {
      return { id: KEY_ID, tenantId: TENANT, organizationId: null, rolesJson: [ROLE_VISIBLE, ROLE_SEARCH], expiresAt: null }
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
          role: { id: ROLE_SEARCH },
          tenantId: TENANT,
          isSuperAdmin: false,
          featuresJson: ['search.view', 'search.embeddings.manage'],
          organizationsJson: world.searchRoleOrganizations,
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

const DRIVER_LIMIT_CAP = 200
type ListOptions = { tenantId: string; organizationId?: string; organizationIds?: string[]; entityId?: string; limit: number; offset: number }
const vectorStrategy = {
  id: 'vector',
  isAvailable: jest.fn(async () => true),
  listEntries: jest.fn(async ({ organizationId, organizationIds, limit, offset }: ListOptions) => {
    const cappedLimit = Math.min(limit, DRIVER_LIMIT_CAP)
    return indexedEntries
      .filter((entry) => (organizationId
        ? entry.organizationId === organizationId
        : !organizationIds || organizationIds.includes(entry.organizationId)))
      .slice(offset, offset + cappedLimit)
  }),
}
const searchIndexer = {
  listEnabledEntities: jest.fn(() => ['customers:customer_entity']),
  purgeEntity: jest.fn(async () => undefined),
}
const container = {
  resolve: (token: string) => {
    if (token === 'em') return em
    if (token === 'rbacService') return rbac
    if (token === 'searchService') return { getStrategies: () => [vectorStrategy] }
    if (token === 'searchIndexer') return searchIndexer
    throw new Error(`unregistered ${token}`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({ recordIndexerLog: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({ writeCoverageCounts: jest.fn(async () => undefined) }))

import { GET, DELETE } from '../index/route'

const apiKeyAuth = { sub: `api_key:${KEY_ID}`, tenantId: TENANT, orgId: null, roles: [], isApiKey: true, isSuperAdmin: false, keyId: KEY_ID }

async function dispatch(handler: (req: Request) => Promise<Response>, method: string, url: string, feature: string) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue(apiKeyAuth)
  const req = new Request(url, { method })
  const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: apiKeyAuth as never, request: req, requiredFeatures: [feature] })
  const ok = await rbac.userHasAllFeatures(apiKeyAuth.sub, [feature], { tenantId: TENANT, organizationId: featureContext.organizationId })
  if (!ok) return { gateOk: false, status: 403, featureContext, body: null }
  const response = await handler(req)
  return { gateOk: true, status: response.status, featureContext, body: await response.json() as { entries: IndexEntry[]; limit: number; offset: number } }
}

const listedOrganizations = () => vectorStrategy.listEntries.mock.calls.map(([options]) => options.organizationIds ?? options.organizationId)
const baseEntries = [...indexedEntries]
const entryIds = (body: { entries: IndexEntry[] } | null) => (body?.entries ?? []).map((entry) => entry.id)

describe('GET /api/search/index for a tenant-level API key without an organization', () => {
  beforeEach(() => {
    vectorStrategy.listEntries.mockClear()
    searchIndexer.purgeEntity.mockClear()
    world.searchRoleOrganizations = [ORG_A]
    indexedEntries.splice(0, indexedEntries.length, ...baseEntries)
    rbac = new RbacService(em as never, undefined, hierarchy as never)
  })

  it('does not grant search.view at organization B to a key restricted to A', async () => {
    expect(await rbac.userHasAllFeatures(apiKeyAuth.sub, ['search.view'], { tenantId: TENANT, organizationId: ORG_B })).toBe(false)
  })

  it('lists only organization A entries when the search role is restricted to A', async () => {
    const result = await dispatch(GET, 'GET', 'http://localhost/api/search/index', 'search.view')
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.scope.filterIds).toEqual([ORG_A])
    expect(result.status).toBe(200)
    expect(listedOrganizations()).toEqual([[ORG_A]])
    const call = vectorStrategy.listEntries.mock.calls[0][0]
    expect(call.tenantId).toBe(TENANT)
    expect(entryIds(result.body)).toEqual(['a1', 'a2', 'a3'])
  })

  it('pages across every approved organization in one driver call when restricted to A and B', async () => {
    world.searchRoleOrganizations = [ORG_A, ORG_B]
    const result = await dispatch(GET, 'GET', 'http://localhost/api/search/index?limit=3&offset=2', 'search.view')
    expect(result.featureContext.scope.filterIds).toEqual([ORG_A, ORG_B])
    expect(result.status).toBe(200)
    expect(vectorStrategy.listEntries).toHaveBeenCalledTimes(1)
    expect(vectorStrategy.listEntries.mock.calls[0][0]).toMatchObject({ organizationIds: [ORG_A, ORG_B], limit: 3, offset: 2 })
    expect(entryIds(result.body)).toEqual(['a3', 'b1', 'b2'])
    expect(result.body).toMatchObject({ limit: 3, offset: 2 })
  })

  it('reads past the driver limit cap when one organization holds more than 200 entries', async () => {
    world.searchRoleOrganizations = [ORG_A, ORG_B]
    const manyA = Array.from({ length: 500 }, (_, index) => ({ id: `a-${index}`, organizationId: ORG_A }))
    indexedEntries.splice(0, indexedEntries.length, ...manyA, ...baseEntries.filter((entry) => entry.organizationId === ORG_B))
    const result = await dispatch(GET, 'GET', 'http://localhost/api/search/index?limit=50&offset=200', 'search.view')
    expect(result.status).toBe(200)
    expect(entryIds(result.body)).toEqual(manyA.slice(200, 250).map((entry) => entry.id))
    const tail = await dispatch(GET, 'GET', 'http://localhost/api/search/index?limit=200&offset=400', 'search.view')
    expect(entryIds(tail.body)).toEqual([...manyA.slice(400).map((entry) => entry.id), 'b1', 'b2', 'b3'])
  })

  it('drops entries outside the approved organizations even if a driver ignores the set filter', async () => {
    vectorStrategy.listEntries.mockImplementationOnce(async () => indexedEntries)
    const result = await dispatch(GET, 'GET', 'http://localhost/api/search/index', 'search.view')
    expect(entryIds(result.body)).toEqual(['a1', 'a2', 'a3'])
  })

  it('keeps one tenant-wide call for a key whose search role is not organization-restricted', async () => {
    world.searchRoleOrganizations = null
    const result = await dispatch(GET, 'GET', 'http://localhost/api/search/index?limit=4&offset=1', 'search.view')
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.scope.filterIds).toBeNull()
    expect(vectorStrategy.listEntries).toHaveBeenCalledTimes(1)
    expect(vectorStrategy.listEntries.mock.calls[0][0]).toMatchObject({ tenantId: TENANT, organizationId: undefined, limit: 4, offset: 1 })
    expect(entryIds(result.body)).toEqual(['a2', 'a3', 'b1', 'b2'])
  })

  it('returns an empty list without calling the driver when no organization is approved', async () => {
    world.searchRoleOrganizations = [ORG_OUTSIDE]
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(apiKeyAuth)
    const req = new Request('http://localhost/api/search/index')
    const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: apiKeyAuth as never, request: req, requiredFeatures: ['search.view'] })
    expect(featureContext.scope.filterIds).toEqual([])
    const response = await GET(req)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [], limit: expect.any(Number), offset: 0 })
    expect(vectorStrategy.listEntries).not.toHaveBeenCalled()
  })

  it('DELETE purges only organization A', async () => {
    const result = await dispatch(DELETE, 'DELETE', 'http://localhost/api/search/index?confirmAll=true', 'search.embeddings.manage')
    expect(result.status).toBe(200)
    const orgs = searchIndexer.purgeEntity.mock.calls.map((call) => ((call as unknown[])[0] as Record<string, unknown>).organizationId)
    expect(orgs).toEqual([ORG_A])
  })
})
