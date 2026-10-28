import type { EntityManager } from '@mikro-orm/postgresql'
import { User, Session } from '@open-mercato/core/modules/auth/data/entities'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { AuthSessionRejectedError } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoUserDeactivation } from '../../data/entities'
import { SsoAuthService } from '../ssoAuthService'

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({ lockAuthorizationUserRows: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' } as User
const expiresAt = new Date(Date.now() + 60_000)

function fixture(markerConfigId: string | null = null, userExists = true) {
  let locked = false
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
    if (!locked) throw new Error('[internal] Eligibility must be read after the parent lock')
    if (entity === User) return userExists ? managedUser : null
    if (entity === SsoUserDeactivation) {
      const filters = where as Record<string, unknown>
      return markerConfigId && filters.tenantId === user.tenantId
        && (!filters.ssoConfigId || filters.ssoConfigId === markerConfigId)
        ? { id: 'marker-1', ssoConfigId: markerConfigId } as SsoUserDeactivation : null
    }
    return null
  })
  return { em, txEm, managedUser, service: new SsoAuthService(em as unknown as EntityManager) }
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
    expect(txEm.create).toHaveBeenCalledWith(Session, expect.objectContaining({ user: managedUser, expiresAt }))
    expect(txEm.persist).toHaveBeenCalledWith(result.session)
    expect(txEm.flush).toHaveBeenCalledTimes(1)
    expect(result.token).toBeTruthy()
  })

  it('denies deactivation observed at final issuance without inserting a session', async () => {
    const { service, txEm } = fixture('config-1')

    await expect(service.createSession(user, expiresAt)).rejects.toBeInstanceOf(AuthSessionRejectedError)
    expect(txEm.create).not.toHaveBeenCalled()
  })

  it('preserves SSO configuration scope independently of the password policy', async () => {
    const { service, txEm } = fixture('config-1')

    await expect(service.createSession(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: 'config-2',
    })).resolves.toHaveProperty('session.id', 'session-1')
    expect(txEm.create).toHaveBeenCalledTimes(1)
  })

  it('does not issue a session for a user removed before the parent lock was acquired', async () => {
    const { service, txEm } = fixture(null, false)

    await expect(service.createSession(user, expiresAt)).rejects.toBeInstanceOf(AuthSessionRejectedError)
    expect(txEm.create).not.toHaveBeenCalled()
  })
})
