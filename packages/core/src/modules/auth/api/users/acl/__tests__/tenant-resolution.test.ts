/** @jest-environment node */

import { User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { GET, PUT } from '../route'

const ACTOR_TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const TARGET_TENANT_ID = '123e4567-e89b-12d3-a456-426614174077'
const TARGET_USER_ID = '123e4567-e89b-12d3-a456-426614174050'

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  find: jest.fn(),
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

function putRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/auth/users/acl', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: TARGET_USER_ID, features: ['catalog.view'], ...body }),
  })
}

function getRequest(params: Record<string, string> = {}) {
  const query = new URLSearchParams({ userId: TARGET_USER_ID, ...params })
  return new Request(`http://localhost/api/auth/users/acl?${query.toString()}`)
}

type AclRow = { id: string; tenantId: string; isSuperAdmin: boolean; featuresJson: string[]; updatedAt: Date }

function aclRow(tenantId: string): AclRow {
  return {
    id: 'acl-1',
    tenantId,
    isSuperAdmin: false,
    featuresJson: ['catalog.view'],
    updatedAt: new Date('2026-08-07T10:00:00.000Z'),
  }
}

/**
 * Honours the tenant predicate the way the column does. `user_acls.tenant_id` is
 * NOT NULL, so a `null` predicate is `tenant_id IS NULL` and matches nothing —
 * the distinction the earlier constructor-only stub could not express, which is
 * why a suite this size never observed the GET/PUT scope split below.
 */
function wireEm(options: { targetUserTenantId: string | null; acls?: AclRow[] }) {
  mockEm.findOne.mockImplementation(async (ctor: unknown, where: { tenantId?: string | null } | undefined) => {
    if (ctor === User) return { id: TARGET_USER_ID, tenantId: options.targetUserTenantId }
    if (ctor === UserAcl) {
      const tenantId = where?.tenantId ?? null
      if (!tenantId) return null
      return (options.acls ?? []).find((acl) => acl.tenantId === tenantId) ?? null
    }
    return null
  })
}

/**
 * `user_acls.tenant_id` is NOT NULL, but `users.tenant_id` is nullable, so a
 * global account logs in with `auth.tenantId === null`. `AuthContext.tenantId` is
 * `string | null` and never `undefined`, so the route previously ran the lookup
 * as `tenant_id IS NULL` against that NOT NULL column: it matched no row, so the
 * create/update path failed the constraint with a 500 and clear was a silent
 * no-op. Nothing cross-tenant was ever matched.
 *
 * Scope now resolves an explicit tenant first, then the actor's, then the target
 * user's, mirroring the role ACL route, and only refuses when none exists — and
 * GET resolves it identically, because the admin form PUTs the ACL panel on
 * every save and a narrower read would clear the override it never showed.
 */
describe('user ACL tenant resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true })
  })

  it('uses the actor tenant when present', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-1' })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [string, { input: { tenantId: string } }]
    expect(options.input.tenantId).toBe(ACTOR_TENANT_ID)
  })

  it('falls back to the target user tenant for a tenant-less actor', async () => {
    // A global account could previously edit or clear an override through the
    // unscoped lookup; that capability is preserved, now correctly scoped.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: null })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [string, { input: { tenantId: string } }]
    expect(options.input.tenantId).toBe(TARGET_TENANT_ID)

    // The ACL lookup must carry a concrete tenant, never an undefined predicate.
    const aclLookup = mockEm.findOne.mock.calls.find(([ctor]) => ctor === UserAcl)
    expect(aclLookup?.[1]).toMatchObject({ tenantId: TARGET_TENANT_ID })
  })

  it('does not read the target user when the actor has a tenant', async () => {
    // The fallback short-circuits on the actor's tenant, so the common path was
    // paying for a decrypting read it discarded — and decrypting a possibly
    // foreign user under the actor's scope while doing it.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-1' })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID })

    await PUT(putRequest())

    expect(mockEm.findOne.mock.calls.some(([ctor]) => ctor === User)).toBe(false)
  })

  it('strips the actor organization when the override lands in another tenant', async () => {
    // `CommandBus.persistLog` resolves the row's organization through a `??`
    // chain, so the handler cannot express "explicitly no organization" — the
    // route has to, exactly as the roles route does. Otherwise the entry pairs
    // the target tenant with an organization from elsewhere and no reader can
    // ever match it.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: 'org-actor' })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [
      string,
      { ctx: { selectedOrganizationId: string | null; organizationIds: string[] | null; auth: { orgId: string | null } } },
    ]
    expect(options.ctx.selectedOrganizationId).toBeNull()
    expect(options.ctx.organizationIds).toBeNull()
    expect(options.ctx.auth.orgId).toBeNull()
  })

  it('keeps the actor organization on a same-tenant override', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-actor' })
    wireEm({ targetUserTenantId: ACTOR_TENANT_ID })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [
      string,
      { ctx: { selectedOrganizationId: string | null; organizationIds: string[] | null } },
    ]
    expect(options.ctx.selectedOrganizationId).toBe('org-actor')
    expect(options.ctx.organizationIds).toEqual(['org-actor'])
  })

  it('reads the override in the same tenant PUT writes it to, for a tenant-less actor', async () => {
    // The regression this pins: GET resolving a narrower scope than PUT hands the
    // admin form an empty ACL panel, and `edit/page.tsx` PUTs that panel on every
    // save — including a name-only edit — which the route then applies as
    // `clear: true`. `updatedAt: null` also leaves the optimistic lock unarmed,
    // so the 409 guard cannot catch it either.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: null })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID, acls: [aclRow(TARGET_TENANT_ID)] })

    const res = await GET(getRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    // A real override must not read as absent...
    expect(body.hasCustomAcl).toBe(true)
    expect(body.features).toEqual(['catalog.view'])
    // ...and the version has to reach the client, or the lock stays unarmed.
    expect(body.updatedAt).toBe('2026-08-07T10:00:00.000Z')

    const aclLookup = mockEm.findOne.mock.calls.find(([ctor]) => ctor === UserAcl)
    expect(aclLookup?.[1]).toMatchObject({ tenantId: TARGET_TENANT_ID })
  })

  it('honours an explicit tenant for a super admin on both verbs', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: null })
    wireEm({ targetUserTenantId: null, acls: [aclRow(TARGET_TENANT_ID)] })

    const readRes = await GET(getRequest({ tenantId: TARGET_TENANT_ID }))
    expect((await readRes.json()).hasCustomAcl).toBe(true)

    const writeRes = await PUT(putRequest({ tenantId: TARGET_TENANT_ID }))
    expect(writeRes.status).toBe(200)
    const [, options] = mockCommandBus.execute.mock.calls[0] as unknown as [string, { input: { tenantId: string } }]
    expect(options.input.tenantId).toBe(TARGET_TENANT_ID)
  })

  it('refuses an explicit foreign tenant for a non-super-admin', async () => {
    // The parameter resolves scope; it must not widen reach.
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-1' })
    wireEm({ targetUserTenantId: TARGET_TENANT_ID, acls: [aclRow(TARGET_TENANT_ID)] })

    const res = await PUT(putRequest({ tenantId: TARGET_TENANT_ID }))

    expect(res.status).toBe(403)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses only when neither the actor nor the target has a tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'admin-1', tenantId: null, orgId: null })
    wireEm({ targetUserTenantId: null })

    const res = await PUT(putRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Tenant required')
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})
