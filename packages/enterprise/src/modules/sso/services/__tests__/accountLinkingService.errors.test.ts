import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { AccountLinkingService } from '../accountLinkingService'
import { isEmailNotVerifiedError, resolveSsoCallbackErrorCode } from '../../lib/errors'
import { ScimToken, SsoIdentity, SsoRoleGrant } from '../../data/entities'
import type { SsoConfig } from '../../data/entities'
import type { SsoIdentityPayload } from '../../lib/types'
import { lockUserRoleWriterAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({
  lockUserRoleWriterAuthorizationState: jest.fn().mockResolvedValue(undefined),
}))

const config = { id: 'cfg-1', organizationId: 'org-1' } as unknown as SsoConfig

type PersistedRoleGrant = { roleId: string; ssoConfigId: string }

function isPersistedRoleGrant(entry: unknown): entry is PersistedRoleGrant {
  return typeof entry === 'object' && entry !== null && 'roleId' in entry && 'ssoConfigId' in entry
}

function buildRoleSyncEntityManager(
  roles: Array<{ id: string; name: string }>,
  rolesAfterLock = roles,
  roleState: {
    grantsBeforeLock?: Array<{ id: string; roleId: string; userId: string; ssoConfigId: string }>
    grantsAfterLock?: Array<{ id: string; roleId: string; userId: string; ssoConfigId: string }>
    userRolesBeforeLock?: Array<{ id: string; role: { id: string }; deletedAt: Date | null }>
    userRolesAfterLock?: Array<{ id: string; role: { id: string }; deletedAt: Date | null }>
  } = {},
) {
  const persisted: unknown[] = []
  let authorizationStateLocked = false
  jest.mocked(lockUserRoleWriterAuthorizationState).mockImplementation(async () => {
    authorizationStateLocked = true
  })

  const em = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === User) return { id: 'user-1', tenantId: data.tenantId, ...data }
      if (entity === SsoIdentity) return { id: 'identity-1', ...data }
      if (entity === SsoRoleGrant) return { id: `grant-${persisted.length + 1}`, ...data }
      if (entity === UserRole) return { id: `user-role-${persisted.length + 1}`, ...data }
      return { ...data }
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === Role) return authorizationStateLocked ? rolesAfterLock : roles
      if (entity === SsoRoleGrant) {
        return authorizationStateLocked
          ? roleState.grantsAfterLock ?? roleState.grantsBeforeLock ?? []
          : roleState.grantsBeforeLock ?? []
      }
      if (entity === UserRole) {
        return authorizationStateLocked
          ? roleState.userRolesAfterLock ?? roleState.userRolesBeforeLock ?? []
          : roleState.userRolesBeforeLock ?? []
      }
      return []
    }),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === ScimToken) return null
      if (entity === SsoRoleGrant) return persisted.find(isPersistedRoleGrant) ?? null
      return null
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
      return { flush: jest.fn().mockResolvedValue(undefined) }
    }),
    remove: jest.fn(),
    transactional: jest.fn(async (callback: (txEm: EntityManager) => Promise<unknown>) => callback(em as unknown as EntityManager)),
    persisted,
  }

  return em
}

async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error('Expected the call to throw, but it resolved')
}

describe('OIDC callback unverified-email error mapping (#2741)', () => {
  it('resolveUser throws an error the callback classifies as sso_email_not_verified', async () => {
    const service = new AccountLinkingService({} as unknown as EntityManager)
    const payload: SsoIdentityPayload = {
      subject: 'sub-1',
      email: 'user@example.com',
      emailVerified: false,
    }

    const thrown = await captureThrow(() => service.resolveUser(config, payload, 'tenant-1'))

    expect(thrown).toBeInstanceOf(Error)
    expect(isEmailNotVerifiedError(thrown)).toBe(true)
    expect(resolveSsoCallbackErrorCode(thrown)).toBe('sso_email_not_verified')
  })

  it('treats omitted email_verified as unverified before link or JIT flows', async () => {
    const service = new AccountLinkingService({} as unknown as EntityManager)
    const payload: SsoIdentityPayload = {
      subject: 'sub-2',
      email: 'user@example.com',
    }
    const strictConfig = {
      id: 'cfg-1',
      organizationId: 'org-1',
      allowedDomains: ['example.com'],
      autoLinkByEmail: false,
      jitEnabled: false,
    } as unknown as SsoConfig

    const thrown = await captureThrow(() => service.resolveUser(strictConfig, payload, 'tenant-1'))

    expect(thrown).toBeInstanceOf(Error)
    expect(isEmailNotVerifiedError(thrown)).toBe(true)
    expect(resolveSsoCallbackErrorCode(thrown)).toBe('sso_email_not_verified')
  })

  it('classifies unrelated callback failures as sso_failed', () => {
    expect(resolveSsoCallbackErrorCode(new Error('State mismatch — possible CSRF attack'))).toBe('sso_failed')
    expect(resolveSsoCallbackErrorCode(new Error('SSO configuration no longer active'))).toBe('sso_failed')
    expect(resolveSsoCallbackErrorCode(undefined)).toBe('sso_failed')
  })
})

describe('SSO app role mappings', () => {
  beforeEach(() => {
    jest.mocked(lockUserRoleWriterAuthorizationState).mockReset()
  })

  const roleConfig = {
    id: 'cfg-1',
    organizationId: 'org-1',
    allowedDomains: ['example.com'],
    autoLinkByEmail: false,
    jitEnabled: true,
    appRoleMappings: {
      engineering: 'employee',
    },
  } as unknown as SsoConfig

  const payload = (groups: string[]): SsoIdentityPayload => ({
    subject: 'sub-1',
    email: 'user@example.com',
    emailVerified: true,
    groups,
  })

  it('does not grant tenant roles from unmapped IdP groups that match role names', async () => {
    const originalGroupRoleMap = process.env.SSO_GROUP_ROLE_MAP
    process.env.SSO_GROUP_ROLE_MAP = JSON.stringify({ admin: 'admin' })

    const em = buildRoleSyncEntityManager([
      { id: 'role-admin', name: 'admin' },
      { id: 'role-employee', name: 'employee' },
    ])
    const service = new AccountLinkingService(em as unknown as EntityManager)

    try {
      await service.resolveUser(roleConfig, payload(['engineering', 'admin']), 'tenant-1')
    } finally {
      if (originalGroupRoleMap === undefined) {
        delete process.env.SSO_GROUP_ROLE_MAP
      } else {
        process.env.SSO_GROUP_ROLE_MAP = originalGroupRoleMap
      }
    }

    const roleGrantIds = em.persisted
      .filter(isPersistedRoleGrant)
      .map((entry) => entry.roleId)

    expect(roleGrantIds).toEqual(['role-employee'])
  })

  it('denies login when no IdP groups match explicit role mappings', async () => {
    const em = buildRoleSyncEntityManager([
      { id: 'role-admin', name: 'admin' },
      { id: 'role-employee', name: 'employee' },
    ])
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['admin']), 'tenant-1')).rejects.toThrow(
      'No roles could be resolved from IdP groups',
    )

    const roleGrantIds = em.persisted
      .filter(isPersistedRoleGrant)
      .map((entry) => entry.roleId)

    expect(roleGrantIds).toEqual([])
  })

  it('recomputes mapped roles after a concurrent role rename completes while acquiring locks', async () => {
    const em = buildRoleSyncEntityManager(
      [{ id: 'role-employee', name: 'employee' }],
      [{ id: 'role-employee', name: 'former-employee' }],
    )
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['engineering']), 'tenant-1')).rejects.toThrow(
      'No roles could be resolved from IdP groups',
    )

    expect(lockUserRoleWriterAuthorizationState).toHaveBeenCalledWith(
      expect.anything(),
      { userIds: ['user-1'], roleIds: ['role-employee'] },
    )
    expect(em.find).toHaveBeenCalledWith(
      Role,
      { tenantId: 'tenant-1', deletedAt: null },
      { refresh: true },
    )
    expect(em.persisted.filter(isPersistedRoleGrant)).toEqual([])
  })

  it('recomputes mapped roles after a concurrent role delete completes while acquiring locks', async () => {
    const em = buildRoleSyncEntityManager(
      [{ id: 'role-employee', name: 'employee' }],
      [],
    )
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['engineering']), 'tenant-1')).rejects.toThrow(
      'No roles could be resolved from IdP groups',
    )

    expect(lockUserRoleWriterAuthorizationState).toHaveBeenCalledWith(
      expect.anything(),
      { userIds: ['user-1'], roleIds: ['role-employee'] },
    )
    expect(em.find).toHaveBeenCalledWith(
      Role,
      { tenantId: 'tenant-1', deletedAt: null },
      { refresh: true },
    )
    expect(em.persisted.filter(isPersistedRoleGrant)).toEqual([])
  })

  it('rejects a post-lock role footprint expansion before creating memberships', async () => {
    const em = buildRoleSyncEntityManager(
      [],
      [{ id: 'role-employee', name: 'employee' }],
    )
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['engineering']), 'tenant-1')).rejects.toMatchObject({
      status: 409,
      body: {
        error: '[internal] Authorization state changed while acquiring its lock footprint',
      },
    })

    expect(lockUserRoleWriterAuthorizationState).toHaveBeenCalledWith(
      expect.anything(),
      { userIds: ['user-1'], roleIds: [] },
    )
    expect(em.find).toHaveBeenCalledWith(
      Role,
      { tenantId: 'tenant-1', deletedAt: null },
      { refresh: true },
    )
    expect(em.create).not.toHaveBeenCalledWith(UserRole, expect.anything())
    expect(em.persisted.filter(isPersistedRoleGrant)).toEqual([])
  })

  it('rejects a post-lock SSO grant-removal footprint expansion before membership or grant writes', async () => {
    const em = buildRoleSyncEntityManager(
      [
        { id: 'role-employee', name: 'employee' },
        { id: 'role-admin', name: 'admin' },
      ],
      [
        { id: 'role-employee', name: 'employee' },
        { id: 'role-admin', name: 'admin' },
      ],
      {
        grantsBeforeLock: [],
        grantsAfterLock: [{
          id: 'grant-admin',
          roleId: 'role-admin',
          userId: 'user-1',
          ssoConfigId: 'cfg-1',
        }],
      },
    )
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['engineering']), 'tenant-1')).rejects.toMatchObject({
      status: 409,
      body: {
        error: '[internal] Authorization state changed while acquiring its lock footprint',
      },
    })

    expect(lockUserRoleWriterAuthorizationState).toHaveBeenCalledWith(
      expect.anything(),
      { userIds: ['user-1'], roleIds: ['role-employee'] },
    )
    expect(em.create).not.toHaveBeenCalledWith(UserRole, expect.anything())
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.persisted.filter(isPersistedRoleGrant)).toEqual([])
  })

  it('commits SSO role revocation before denying a linked user whose IdP groups map to zero roles', async () => {
    const { findOneWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
      findOneWithDecryption: jest.Mock
    }
    findOneWithDecryption
      .mockResolvedValueOnce({ id: 'identity-1', userId: 'user-1', lastLoginAt: null, deletedAt: null })
      .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
    const staleGrant = { id: 'grant-employee', roleId: 'role-employee', userId: 'user-1', ssoConfigId: 'cfg-1' }
    const staleMembership = { id: 'user-role-employee', role: { id: 'role-employee' }, deletedAt: null }
    const removed: unknown[] = []
    const transactionOutcomes: string[] = []
    const em = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === Role) return [{ id: 'role-employee', name: 'employee' }]
        if (entity === SsoRoleGrant) return [staleGrant]
        if (entity === UserRole) return [staleMembership]
        return []
      }),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === UserRole) return removed.includes(staleMembership) ? null : staleMembership
        if (entity === SsoRoleGrant) return removed.includes(staleGrant) ? null : staleGrant
        return null
      }),
      flush: jest.fn().mockResolvedValue(undefined),
      persist: jest.fn(() => ({ flush: jest.fn().mockResolvedValue(undefined) })),
      remove: jest.fn((entity: unknown) => {
        removed.push(entity)
      }),
      transactional: jest.fn(async (callback: (txEm: EntityManager) => Promise<unknown>) => {
        try {
          const result = await callback(em as unknown as EntityManager)
          transactionOutcomes.push('committed')
          return result
        } catch (err) {
          transactionOutcomes.push('rolled-back')
          throw err
        }
      }),
    }
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['unmapped']), 'tenant-1')).rejects.toThrow(
      'No roles could be resolved from IdP groups — login denied. Configure role mappings or ensure the IdP sends matching group claims.',
    )

    expect(transactionOutcomes).toEqual(['committed'])
    expect(removed).toEqual(expect.arrayContaining([staleGrant, staleMembership]))
    expect(em.flush).toHaveBeenCalled()
  })

  it('lets the caller-owned JIT transaction roll back when a new user maps to zero roles', async () => {
    const em = buildRoleSyncEntityManager([{ id: 'role-employee', name: 'employee' }])
    let transactionDepth = 0
    const transactionOutcomes: string[] = []
    Object.assign(em, {
      isInTransaction: () => transactionDepth > 0,
      transactional: jest.fn(async (callback: (txEm: EntityManager) => Promise<unknown>) => {
        transactionDepth += 1
        try {
          const result = await callback(em as unknown as EntityManager)
          transactionOutcomes.push('committed')
          return result
        } catch (err) {
          transactionOutcomes.push('rolled-back')
          throw err
        } finally {
          transactionDepth -= 1
        }
      }),
    })
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['unmapped']), 'tenant-1')).rejects.toThrow(
      'No roles could be resolved from IdP groups',
    )

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(transactionOutcomes).toEqual(['rolled-back'])
  })

  it('rejects a post-lock soft-deleted membership cleanup footprint expansion before writes', async () => {
    const em = buildRoleSyncEntityManager(
      [
        { id: 'role-employee', name: 'employee' },
        { id: 'role-admin', name: 'admin' },
      ],
      [
        { id: 'role-employee', name: 'employee' },
        { id: 'role-admin', name: 'admin' },
      ],
      {
        userRolesBeforeLock: [],
        userRolesAfterLock: [{
          id: 'user-role-admin',
          role: { id: 'role-admin' },
          deletedAt: new Date('2026-10-05T00:00:00.000Z'),
        }],
      },
    )
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(roleConfig, payload(['engineering']), 'tenant-1')).rejects.toMatchObject({
      status: 409,
      body: {
        error: '[internal] Authorization state changed while acquiring its lock footprint',
      },
    })

    expect(lockUserRoleWriterAuthorizationState).toHaveBeenCalledWith(
      expect.anything(),
      { userIds: ['user-1'], roleIds: ['role-employee'] },
    )
    expect(em.create).not.toHaveBeenCalledWith(UserRole, expect.anything())
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.persisted.filter(isPersistedRoleGrant)).toEqual([])
  })
})
