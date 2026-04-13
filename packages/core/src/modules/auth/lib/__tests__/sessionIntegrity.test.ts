import { RoleAcl, Session, User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { isAuthContextValid, resolveCanonicalStaffAuthContext } from '@open-mercato/core/modules/auth/lib/sessionIntegrity'

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const userId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const scopedTenantId = '44444444-4444-4444-8444-444444444444'
const scopedOrganizationId = '55555555-5555-4555-8555-555555555555'
const adminRoleId = '66666666-6666-4666-8666-666666666666'
const impostorRoleId = '77777777-7777-4777-8777-777777777777'
const sessionId = '88888888-8888-4888-8888-888888888888'

type MockStore = {
  user?: unknown
  userAcl?: unknown
  roleAcl?: unknown
}

function mockFindOneByEntity(store: MockStore & { session?: SessionLookupResult }) {
  findOneWithDecryption.mockImplementation(async (...args: unknown[]) => {
    const entity = args[1]
    if (entity === Session) return store.session ?? null
    if (entity === User) return store.user ?? null
    if (entity === UserAcl) return store.userAcl ?? null
    if (entity === RoleAcl) return store.roleAcl ?? null
    return null
  })
}

type SessionLookupResult = { id: string; deletedAt: Date | null; expiresAt: Date } | null

const validSession: SessionLookupResult = {
  id: sessionId,
  deletedAt: null,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
}

describe('isAuthContextValid', () => {
  const em = {} as import('@mikro-orm/postgresql').EntityManager

  beforeEach(() => {
    jest.clearAllMocks()
    findWithDecryption.mockResolvedValue([])
    findOneWithDecryption.mockResolvedValue(null)
  })

  it('accepts a user that still exists in the same tenant and organization', async () => {
    mockFindOneByEntity({ session: validSession, user: { id: userId, tenantId, organizationId } })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(true)

    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      User,
      { id: userId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
  })

  it('returns canonical auth with roles refreshed from the database', async () => {
    mockFindOneByEntity({
      session: validSession,
      user: { id: userId, tenantId, organizationId },
      roleAcl: { isSuperAdmin: true },
    })
    findWithDecryption.mockResolvedValue([
      { role: { id: adminRoleId, name: 'admin' } },
      { role: { id: impostorRoleId, name: 'superadmin' } },
    ])

    await expect(
      resolveCanonicalStaffAuthContext(em, {
        sub: userId,
        sid: sessionId,
        tenantId,
        orgId: organizationId,
        roles: ['employee'],
      }),
    ).resolves.toEqual({
      sub: userId,
      sid: sessionId,
      tenantId,
      orgId: organizationId,
      roles: ['admin', 'superadmin'],
      isSuperAdmin: true,
    })
  })

  it('does not elevate a user whose role is merely named "superadmin" without a RoleAcl flag', async () => {
    mockFindOneByEntity({
      session: validSession,
      user: { id: userId, tenantId, organizationId },
    })
    findWithDecryption.mockResolvedValue([
      { role: { id: impostorRoleId, name: 'Superadmin' } },
    ])

    await expect(
      resolveCanonicalStaffAuthContext(em, {
        sub: userId,
        sid: sessionId,
        tenantId,
        orgId: organizationId,
        roles: ['Superadmin'],
      }),
    ).resolves.toEqual({
      sub: userId,
      sid: sessionId,
      tenantId,
      orgId: organizationId,
      roles: ['Superadmin'],
      isSuperAdmin: false,
    })
  })

  it('elevates a user whose role has UserAcl.isSuperAdmin flag set', async () => {
    mockFindOneByEntity({
      session: validSession,
      user: { id: userId, tenantId, organizationId },
      userAcl: { isSuperAdmin: true },
    })
    findWithDecryption.mockResolvedValue([
      { role: { id: adminRoleId, name: 'admin' } },
    ])

    await expect(
      resolveCanonicalStaffAuthContext(em, {
        sub: userId,
        sid: sessionId,
        tenantId,
        orgId: organizationId,
        roles: ['admin'],
      }),
    ).resolves.toEqual({
      sub: userId,
      sid: sessionId,
      tenantId,
      orgId: organizationId,
      roles: ['admin'],
      isSuperAdmin: true,
    })
  })

  it('rejects an auth context when the user no longer exists', async () => {
    mockFindOneByEntity({ session: validSession, user: null })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('rejects an auth context when the persisted tenant or organization changed', async () => {
    mockFindOneByEntity({
      session: validSession,
      user: { id: userId, tenantId, organizationId: scopedOrganizationId },
    })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('validates superadmin scoped sessions against actor scope, not selected scope', async () => {
    mockFindOneByEntity({
      session: validSession,
      user: { id: userId, tenantId, organizationId },
      roleAcl: { isSuperAdmin: true },
    })
    findWithDecryption.mockResolvedValue([
      { role: { id: adminRoleId, name: 'admin' } },
    ])

    await expect(
      isAuthContextValid(em, {
        sub: userId,
        sid: sessionId,
        tenantId: scopedTenantId,
        orgId: scopedOrganizationId,
        actorTenantId: tenantId,
        actorOrgId: organizationId,
        roles: ['admin'],
        isSuperAdmin: true,
      }),
    ).resolves.toBe(true)
  })

  it('rejects legacy tokens without an sid claim so clients must re-authenticate', async () => {
    await expect(
      isAuthContextValid(em, { sub: userId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)

    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects tokens whose referenced session has been deleted (logout/password reset)', async () => {
    findOneWithDecryption.mockResolvedValue(null)

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('rejects tokens whose session row exists but has already expired', async () => {
    const expiredSession: SessionLookupResult = {
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    }
    findOneWithDecryption.mockImplementation(async (...args: unknown[]) => {
      const entity = args[1]
      if (entity === Session) return expiredSession
      return null
    })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('rejects tokens whose sid is not a valid uuid', async () => {
    await expect(
      isAuthContextValid(em, { sub: userId, sid: 'not-a-uuid', tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)

    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('skips user integrity lookup for api key auth', async () => {
    await expect(
      isAuthContextValid(em, {
        sub: 'api_key:abc',
        tenantId,
        orgId: organizationId,
        isApiKey: true,
      }),
    ).resolves.toBe(true)

    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })
})
