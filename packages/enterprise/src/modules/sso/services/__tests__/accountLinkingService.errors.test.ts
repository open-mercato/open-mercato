import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { AccountLinkingService } from '../accountLinkingService'
import { isEmailNotVerifiedError, resolveSsoCallbackErrorCode } from '../../lib/errors'
import { ScimToken, SsoIdentity, SsoRoleGrant } from '../../data/entities'
import type { SsoConfig } from '../../data/entities'
import type { SsoIdentityPayload } from '../../lib/types'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

const config = { id: 'cfg-1', organizationId: 'org-1' } as unknown as SsoConfig

type PersistedRoleGrant = { roleId: string; ssoConfigId: string }

function isPersistedRoleGrant(entry: unknown): entry is PersistedRoleGrant {
  return typeof entry === 'object' && entry !== null && 'roleId' in entry && 'ssoConfigId' in entry
}

function buildRoleSyncEntityManager(roles: Array<{ id: string; name: string }>) {
  const persisted: unknown[] = []

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
      if (entity === Role) return roles
      if (entity === SsoRoleGrant) return []
      if (entity === UserRole) return []
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
})
