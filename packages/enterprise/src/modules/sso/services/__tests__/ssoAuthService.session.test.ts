import type { EntityManager } from '@mikro-orm/postgresql'
import { User, Session } from '@open-mercato/core/modules/auth/data/entities'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { AuthSessionRejectedError } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { SsoConfig, SsoUserDeactivation } from '../../data/entities'
import type { SsoAuthorizationService } from '../ssoAuthorizationService'
import { SsoAuthService } from '../ssoAuthService'

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({ lockAuthorizationUserRows: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' } as User
const expiresAt = new Date(Date.now() + 60_000)

function fixture(markerConfigId: string | null = null, userExists = true, tenantActive = true) {
  let locked = false
  const config = {
    id: 'config-2', tenantId: 'tenant-1', organizationId: 'org-1',
    updatedAt: new Date('2026-11-15T00:00:00.000Z'),
  } as SsoConfig
  const authorization = {
    assertAccount: jest.fn(async () => {
      locked = true
      return 'tenant-1'
    }),
  }
  const managedUser = { ...user } as User
  const txEm = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'session-1', ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  txEm.persist.mockReturnValue(txEm)
  const em = {
    transactional: jest.fn(async (callback: (transaction: EntityManager) => Promise<unknown>) => callback(txEm as unknown as EntityManager)),
  }
  jest.mocked(lockAuthorizationUserRows).mockImplementation(async () => { locked = true })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    if (entity === SsoConfig) return config
    if (!locked) throw new Error('[internal] Eligibility must be read after the parent lock')
    if (entity === User) return userExists ? managedUser : null
    if (entity === Tenant) return tenantActive ? { id: user.tenantId } as Tenant : null
    if (entity === SsoUserDeactivation) {
      const filters = where as Record<string, unknown>
      return markerConfigId && filters.tenantId === user.tenantId
        && (!filters.ssoConfigId || filters.ssoConfigId === markerConfigId)
        ? { id: 'marker-1', ssoConfigId: markerConfigId } as SsoUserDeactivation : null
    }
    return null
  })
  return {
    em, txEm, managedUser, config, authorization,
    service: new SsoAuthService(em as unknown as EntityManager, authorization as unknown as SsoAuthorizationService),
  }
}

describe('atomic SSO-aware session issuance', () => {
  beforeEach(() => {
    jest.mocked(lockAuthorizationUserRows).mockReset()
    jest.mocked(findOneWithDecryption).mockReset()
  })

  it('holds the shared user lock while checking eligibility and inserting through the transaction manager', async () => {
    const { service, em, txEm, managedUser } = fixture()
    const result = await service.createSession(user, expiresAt)

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(lockAuthorizationUserRows).toHaveBeenCalledWith(txEm, ['user-1'])
    expect(findOneWithDecryption).toHaveBeenCalledWith(txEm, User,
      { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
      { refresh: true }, { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(findOneWithDecryption).toHaveBeenCalledWith(txEm, Tenant,
      { id: 'tenant-1', isActive: true, deletedAt: null }, { fields: ['id'], refresh: true })
    expect(txEm.create).toHaveBeenCalledWith(Session, expect.objectContaining({ user: managedUser, expiresAt }))
    expect(txEm.persist).toHaveBeenCalledWith(result.session)
    expect(txEm.flush).toHaveBeenCalledTimes(1)
    expect(result.token).toBeTruthy()
  })

  it('preserves tenant denial inside the SSO session transaction', async () => {
    const { service, txEm } = fixture(null, true, false)

    await expect(service.createSession(user, expiresAt)).rejects.toThrow('[internal] Tenant is not available for authentication')
    expect(txEm.create).not.toHaveBeenCalled()
    expect(txEm.persist).not.toHaveBeenCalled()
  })

  it('denies deactivation observed at final issuance without inserting a session', async () => {
    const { service, txEm } = fixture('config-1')

    await expect(service.createSession(user, expiresAt)).rejects.toBeInstanceOf(AuthSessionRejectedError)
    expect(txEm.create).not.toHaveBeenCalled()
  })

  it('preserves SSO configuration scope independently of the password policy', async () => {
    const { service, txEm, config } = fixture('config-1')

    await expect(service.createSession(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: 'config-2', configUpdatedAt: config.updatedAt.getTime(),
    })).resolves.toHaveProperty('session.id', 'session-1')
    expect(txEm.create).toHaveBeenCalledTimes(1)
  })

  it('does not issue a session for a user removed before the parent lock was acquired', async () => {
    const { service, txEm } = fixture(null, false)

    await expect(service.createSession(user, expiresAt)).rejects.toBeInstanceOf(AuthSessionRejectedError)
    expect(txEm.create).not.toHaveBeenCalled()
  })

  it('checks current account authority in the session transaction after locking the config', async () => {
    const { service, txEm, config, authorization } = fixture()

    await service.createSession(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: config.id,
      configUpdatedAt: config.updatedAt.getTime(),
    })

    expect(authorization.assertAccount).toHaveBeenCalledWith(txEm, config, user)
    expect(jest.mocked(findOneWithDecryption).mock.invocationCallOrder[0]).toBeLessThan(
      authorization.assertAccount.mock.invocationCallOrder[0],
    )
    expect(authorization.assertAccount.mock.invocationCallOrder[0]).toBeLessThan(txEm.create.mock.invocationCallOrder[0])
    expect(lockAuthorizationUserRows).not.toHaveBeenCalled()
  })

  it.each(['target promoted after linking', 'config author demoted after linking'])(
    'refuses a fresh session when %s', async () => {
      const { service, txEm, config, authorization } = fixture()
      const denial = new Error('[internal] Authority ceiling exceeded')
      authorization.assertAccount.mockRejectedValueOnce(denial)

      await expect(service.createSession(user, expiresAt, {
        tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: config.id,
        configUpdatedAt: config.updatedAt.getTime(),
      })).rejects.toBe(denial)

      expect(txEm.create).not.toHaveBeenCalled()
      expect(txEm.persist).not.toHaveBeenCalled()
    },
  )

  it('rejects a configuration edited after its provider verified the assertion', async () => {
    const { service, txEm, config, authorization } = fixture()

    await expect(service.createSession(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: config.id,
      configUpdatedAt: config.updatedAt.getTime() - 1,
    })).rejects.toBeInstanceOf(AuthSessionRejectedError)

    expect(authorization.assertAccount).not.toHaveBeenCalled()
    expect(txEm.create).not.toHaveBeenCalled()
  })

  it('requires a provider configuration version for SSO session issuance', async () => {
    const { service, txEm, config } = fixture()

    await expect(service.createSession(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: config.id,
    })).rejects.toBeInstanceOf(AuthSessionRejectedError)

    expect(txEm.create).not.toHaveBeenCalled()
  })

  it('fails closed when an SSO session has no authorization service', async () => {
    const { em, txEm, config } = fixture()
    const service = new SsoAuthService(em as unknown as EntityManager)

    await expect(service.createSession(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: config.id,
      configUpdatedAt: config.updatedAt.getTime(),
    })).rejects.toThrow('[internal] SSO authorization service is unavailable')

    expect(txEm.create).not.toHaveBeenCalled()
  })

  it('refuses a scope outside the organization tenant resolved by authorization', async () => {
    const { service, txEm, config } = fixture()

    await expect(service.createSession(user, expiresAt, {
      tenantId: 'other-tenant', organizationId: 'org-1', ssoConfigId: config.id,
      configUpdatedAt: config.updatedAt.getTime(),
    })).rejects.toBeInstanceOf(AuthSessionRejectedError)

    expect(txEm.create).not.toHaveBeenCalled()
  })
})
