/** @jest-environment node */
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserRole, RoleAcl, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ROLE_VISIBLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const ROLE_CUSTOMERS_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const PERSON_IN_B = 'ffffffff-ffff-4fff-8fff-fffffffffff1'

const roleAcls = [
  { role: { id: ROLE_VISIBLE }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['dashboards.view'], organizationsJson: null },
  { role: { id: ROLE_CUSTOMERS_A }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['customers.people.view', 'customers.people.manage'], organizationsJson: [ORG_A] },
]
const organizations = [
  { id: ORG_A, tenant: TENANT, ancestorIds: [], descendantIds: [] },
  { id: ORG_B, tenant: TENANT, ancestorIds: [], descendantIds: [] },
]

const em: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === ApiKey && where.id === KEY_ID) {
      return { id: KEY_ID, tenantId: TENANT, organizationId: null, rolesJson: [ROLE_VISIBLE, ROLE_CUSTOMERS_A], expiresAt: null }
    }
    if (entity === UserAcl || entity === User) return null
    return null
  }),
  find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === RoleAcl) return where.isSuperAdmin === true ? [] : roleAcls
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
const rbac = new RbacService(em as never, undefined, hierarchy as never)
const queryEngine = { query: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })) }
const storedPersonInB = { id: PERSON_IN_B, tenantId: TENANT, organizationId: ORG_B }
const commandBus = {
  execute: jest.fn(async (commandId: string, { input, ctx }: { input: Record<string, unknown>; ctx: never }) => {
    if (commandId === 'customers.people.create') {
      ensureTenantScope(ctx, String(input.tenantId))
      ensureOrganizationScope(ctx, String(input.organizationId))
      return { result: { id: 'new-id' }, logEntry: null }
    }
    if (commandId === 'customers.people.update' || commandId === 'customers.people.delete') {
      ensureTenantScope(ctx, storedPersonInB.tenantId)
      ensureOrganizationScope(ctx, storedPersonInB.organizationId)
      return { result: { id: PERSON_IN_B }, logEntry: null }
    }
    throw new Error(`unexpected ${commandId}`)
  }),
}
const container = {
  resolve: (token: string) => {
    if (token === 'em') return em
    if (token === 'rbacService') return rbac
    if (token === 'queryEngine') return queryEngine
    if (token === 'commandBus') return commandBus
    throw new Error(`unregistered ${token}`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn(), getAuthFromCookies: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key, translate: (key: string, fallback?: string) => fallback ?? key }),
}))

import { GET, POST, PUT } from '@open-mercato/core/modules/customers/api/people/route'

const apiKeyAuth = { sub: `api_key:${KEY_ID}`, tenantId: TENANT, orgId: null, roles: [], isApiKey: true, isSuperAdmin: false, keyId: KEY_ID }

async function dispatch(handler: (req: Request) => Promise<Response>, method: string, url: string, feature: string, body?: unknown) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue(apiKeyAuth)
  const req = new Request(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const featureContext = await resolveFeatureCheckContext({ container: container as never, auth: apiKeyAuth as never, request: req, requiredFeatures: [feature] })
  const ok = await rbac.userHasAllFeatures(apiKeyAuth.sub, [feature], { tenantId: TENANT, organizationId: featureContext.organizationId })
  if (!ok) return { gateOk: false, status: 403, featureContext }
  const response = await handler(req)
  return { gateOk: true, status: response.status, featureContext, body: await response.json().catch(() => null) }
}

describe('makeCrudRoute (customers.people) for a tenant-level API key whose role is restricted to organization A', () => {
  beforeEach(() => {
    queryEngine.query.mockClear()
    commandBus.execute.mockClear()
  })

  it('does not grant customers.people.view at organization B', async () => {
    expect(await rbac.userHasAllFeatures(apiKeyAuth.sub, ['customers.people.view'], { tenantId: TENANT, organizationId: ORG_B })).toBe(false)
    expect(await rbac.userHasAllFeatures(apiKeyAuth.sub, ['customers.people.view'], { tenantId: TENANT, organizationId: ORG_A })).toBe(true)
  })

  it('GET list: the gate is evaluated at organization A and the query is narrowed to organizationIds=[A]', async () => {
    const result = await dispatch(GET, 'GET', 'http://localhost/api/customers/people', 'customers.people.view')
    expect(result.gateOk).toBe(true)
    expect(result.featureContext.organizationId).toBe(ORG_A)
    expect(result.status).toBe(200)
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    const opts = (queryEngine.query.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(opts.tenantId).toBe(TENANT)
    expect(opts.organizationIds).toEqual([ORG_A])
    expect(opts.organizationId).toBeUndefined()
  })

  it('POST create with body organizationId=B is rejected by ensureOrganizationScope (403)', async () => {
    const result = await dispatch(POST, 'POST', 'http://localhost/api/customers/people', 'customers.people.manage', {
      organizationId: ORG_B, firstName: 'X', lastName: 'Y', displayName: 'X Y',
    })
    expect(result.gateOk).toBe(true)
    expect(result.status).toBe(403)
  })

  it('POST create with no organizationId is still rejected (400, no null-org record)', async () => {
    const result = await dispatch(POST, 'POST', 'http://localhost/api/customers/people', 'customers.people.manage', {
      firstName: 'X', lastName: 'Y', displayName: 'X Y',
    })
    expect(result.status).toBe(400)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('POST create with body organizationId=A succeeds', async () => {
    const result = await dispatch(POST, 'POST', 'http://localhost/api/customers/people', 'customers.people.manage', {
      organizationId: ORG_A, firstName: 'X', lastName: 'Y', displayName: 'X Y',
    })
    expect(result.status).toBe(201)
  })

  it('PUT update of a record stored in organization B is rejected (403)', async () => {
    const result = await dispatch(PUT, 'PUT', 'http://localhost/api/customers/people', 'customers.people.manage', {
      id: PERSON_IN_B, organizationId: ORG_A, displayName: 'changed',
    })
    expect(result.gateOk).toBe(true)
    expect(result.status).toBe(403)
  })
})
