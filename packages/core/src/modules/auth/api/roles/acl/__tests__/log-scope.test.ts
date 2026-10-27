/** @jest-environment node */

import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { PUT } from '../route'

const ACTOR_TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const FOREIGN_TENANT_ID = '123e4567-e89b-12d3-a456-426614174099'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174050'

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

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn((args: unknown) => mockResolveIsSuperAdmin(args)),
}))

// Grant checks have their own dedicated coverage in `tenant-scoping.test.ts`;
// stubbing them here keeps these tests focused on what scope the audit entry
// is written with once the request is authorized.
jest.mock('@open-mercato/core/modules/auth/lib/grantChecks', () => ({
  assertActorCanGrantAcl: jest.fn(async () => undefined),
  assertActorCanModifySuperAdminRoleTarget: jest.fn(async () => undefined),
  normalizeGrantFeatureList: (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
}))

function putRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/roles/acl', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dispatchedCtx(): Record<string, unknown> {
  const call = mockCommandBus.execute.mock.calls[0] as unknown as [string, { ctx: Record<string, unknown> }]
  return call[1].ctx
}

/**
 * `CommandBus.persistLog` resolves the log row's organization as
 * `metadata.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId`.
 * Because that is a `??` chain, a command handler cannot express "explicitly no
 * organization" by returning null — the actor's organization wins.
 *
 * A super admin may edit a role in another tenant, and `ActionLogService`
 * filters organization with strict equality, so an entry stamped
 * (foreign tenant, actor's own organization) is unmatchable for every reader.
 * The route must therefore strip the organization from the command context.
 */
describe('role ACL audit-entry scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-actor' })
    mockResolveIsSuperAdmin.mockResolvedValue(true)
  })

  function withRoleTenant(roleTenantId: string | null) {
    mockEm.findOne.mockImplementation(async (ctor: unknown) => {
      if (ctor === Role) return { id: ROLE_ID, tenantId: roleTenantId }
      if (ctor === RoleAcl) return null
      return null
    })
  }

  it('strips the actor organization when the target tenant is not the actor tenant', async () => {
    withRoleTenant(FOREIGN_TENANT_ID)

    const res = await PUT(putRequest({ roleId: ROLE_ID, features: ['catalog.view'], tenantId: FOREIGN_TENANT_ID }))

    expect(res.status).toBe(200)
    expect(mockCommandBus.execute).toHaveBeenCalledTimes(1)
    const ctx = dispatchedCtx()
    expect(ctx.selectedOrganizationId).toBeNull()
    expect(ctx.organizationIds).toBeNull()
    expect((ctx.auth as { orgId: string | null }).orgId).toBeNull()
  })

  it('keeps the actor organization on a same-tenant edit', async () => {
    withRoleTenant(ACTOR_TENANT_ID)

    const res = await PUT(putRequest({ roleId: ROLE_ID, features: ['catalog.view'] }))

    expect(res.status).toBe(200)
    const ctx = dispatchedCtx()
    expect(ctx.selectedOrganizationId).toBe('org-actor')
    expect(ctx.organizationIds).toEqual(['org-actor'])
    expect((ctx.auth as { orgId: string | null }).orgId).toBe('org-actor')
  })

  it('dispatches the target tenant, not the actor tenant', async () => {
    withRoleTenant(FOREIGN_TENANT_ID)

    await PUT(putRequest({ roleId: ROLE_ID, features: ['catalog.view'], tenantId: FOREIGN_TENANT_ID }))

    const call = mockCommandBus.execute.mock.calls[0] as unknown as [string, { input: { tenantId: string } }]
    expect(call[0]).toBe('auth.role-acl.update')
    expect(call[1].input.tenantId).toBe(FOREIGN_TENANT_ID)
  })
})
