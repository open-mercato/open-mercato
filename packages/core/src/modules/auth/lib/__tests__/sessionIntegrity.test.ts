import type { EntityManager } from '@mikro-orm/postgresql'
import { Session, User } from '@open-mercato/core/modules/auth/data/entities'
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
const sessionId = '66666666-6666-4666-8666-666666666666'

type SessionLookupResult = { id: string; deletedAt: Date | null; expiresAt: Date } | null

describe('isAuthContextValid', () => {
  let sessionLookup: SessionLookupResult
  const em = {
    findOne: jest.fn(async (entity: unknown, filter: Record<string, unknown>) => {
      if (entity === Session) {
        if (!sessionLookup) return null
        if (filter.id !== sessionLookup.id) return null
        return sessionLookup
      }
      return null
    }),
  } as unknown as EntityManager

  beforeEach(() => {
    jest.clearAllMocks()
    findWithDecryption.mockResolvedValue([])
    sessionLookup = {
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }
  })

  it('accepts a user that still exists in the same tenant and organization', async () => {
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
    })

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
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
    })
    findWithDecryption.mockResolvedValue([
      { role: { name: 'admin' } },
      { role: { name: 'superadmin' } },
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

  it('rejects an auth context when the user no longer exists', async () => {
    findOneWithDecryption.mockResolvedValue(null)

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('rejects an auth context when the persisted tenant or organization changed', async () => {
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId: scopedOrganizationId,
    })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('validates superadmin scoped sessions against actor scope, not selected scope', async () => {
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
    })

    await expect(
      isAuthContextValid(em, {
        sub: userId,
        sid: sessionId,
        tenantId: scopedTenantId,
        orgId: scopedOrganizationId,
        actorTenantId: tenantId,
        actorOrgId: organizationId,
        roles: ['superadmin'],
        isSuperAdmin: true,
      }),
    ).resolves.toBe(true)
  })

  it('rejects legacy tokens without an sid claim so clients must re-authenticate', async () => {
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
    })

    await expect(
      isAuthContextValid(em, { sub: userId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)

    expect(em.findOne).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects tokens whose referenced session has been deleted (logout/password reset)', async () => {
    sessionLookup = null
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
    })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)

    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects tokens whose session row exists but has already expired', async () => {
    sessionLookup = {
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    }
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
    })

    await expect(
      isAuthContextValid(em, { sub: userId, sid: sessionId, tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)
  })

  it('rejects tokens whose sid is not a valid uuid', async () => {
    await expect(
      isAuthContextValid(em, { sub: userId, sid: 'not-a-uuid', tenantId, orgId: organizationId, roles: [] }),
    ).resolves.toBe(false)

    expect(em.findOne).not.toHaveBeenCalled()
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
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
