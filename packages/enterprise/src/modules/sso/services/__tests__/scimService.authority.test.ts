import { EntityManager, LockMode } from '@mikro-orm/postgresql'
import { Session, User } from '@open-mercato/core/modules/auth/data/entities'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoConfig, SsoIdentity, SsoUserDeactivation } from '../../data/entities'
import type { ScimScope } from '../../api/scim/context'
import type { SsoAuthorizationService } from '../ssoAuthorizationService'
import { ScimService } from '../scimService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({
  lockAuthorizationUserRows: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })),
}))

const baseUrl = 'https://mercato.example'
const now = new Date('2026-11-15T00:00:00.000Z')

function fixture(options: { existingUser?: boolean; existingIdentity?: boolean; config?: Partial<SsoConfig> } = {}) {
  const config = {
    id: 'config-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    isActive: true,
    jitEnabled: false,
    authorizationUserId: 'config-author',
    deletedAt: null,
    ...options.config,
  } as SsoConfig
  const user = {
    id: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    name: 'Original Name',
    email: 'staff@example.com',
    deletedAt: null,
  } as User
  const identity = {
    id: 'identity-1',
    userId: user.id,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    ssoConfigId: config.id,
    idpSubject: 'staff-id',
    externalId: 'staff-id',
    idpEmail: user.email,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as SsoIdentity
  const scope: ScimScope = {
    ssoConfigId: config.id,
    organizationId: 'org-1',
    tenantId: config.tenantId ?? null,
    actorUserId: 'token-author',
    config,
  }
  let deactivation: SsoUserDeactivation | null = null
  const em = {
    transactional: jest.fn(),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === SsoIdentity) return options.existingIdentity ? identity : null
      if (entity === SsoUserDeactivation) return deactivation
      return null
    }),
    create: jest.fn((entity: unknown, values: Record<string, unknown>) => {
      const record = { id: entity === User ? 'new-user' : 'new-record', ...values }
      if (entity === SsoUserDeactivation) deactivation = record as unknown as SsoUserDeactivation
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeDelete: jest.fn(async () => 0),
  }
  em.persist.mockReturnValue(em)
  em.transactional.mockImplementation(async (operation: (manager: EntityManager) => Promise<unknown>) => operation(em as unknown as EntityManager))
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, where) => {
    if (entity === SsoConfig) {
      const query = where as Record<string, unknown>
      return query.organizationId === config.organizationId && query.tenantId === config.tenantId ? config : null
    }
    if (entity === User) return options.existingUser ? user : null
    if (entity === SsoUserDeactivation) return null
    throw new Error('[internal] Unexpected test entity')
  })
  const authorization = {
    assertConfiguration: jest.fn().mockResolvedValue('tenant-1'),
    assertAccount: jest.fn().mockResolvedValue('tenant-1'),
  }
  const service = new ScimService(em as unknown as EntityManager, authorization as unknown as SsoAuthorizationService)
  return { config, scope, user, identity, em, authorization, service }
}

describe('SCIM authority boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(['getUser', 'listUsers'] as const)('denies legacy tokens on directory %s reads', async (operation) => {
    const { service, scope, em } = fixture()
    const legacyScope = { ...scope, actorUserId: null }
    const result = operation === 'getUser'
      ? service.getUser('identity-1', legacyScope, baseUrl)
      : service.listUsers(null, 1, 100, legacyScope, baseUrl)
    await expect(result).rejects.toMatchObject({ status: 403 })
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it.each(['getUser', 'listUsers'] as const)('requires current author permission for directory %s reads', async (operation) => {
    const { service, scope, authorization, em } = fixture({ existingUser: true, existingIdentity: true })
    authorization.assertConfiguration.mockRejectedValue(forbidden('denied'))
    const result = operation === 'getUser'
      ? service.getUser('identity-1', scope, baseUrl)
      : service.listUsers(null, 1, 100, scope, baseUrl)
    await expect(result).rejects.toMatchObject({ status: 403 })
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('denies legacy tokens before opening a mutation transaction', async () => {
    const { service, scope, em, authorization } = fixture()
    await expect(service.createUser({ userName: 'new@example.com' }, {
      ...scope,
      actorUserId: null,
    }, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(em.transactional).not.toHaveBeenCalled()
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('fails closed when the authorization dependency is unavailable', async () => {
    const { scope, em } = fixture()
    const service = new ScimService(em as unknown as EntityManager)
    await expect(service.createUser({ userName: 'new@example.com' }, scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('checks fresh configuration and both authors before creating a user in the actual tenant', async () => {
    const { service, scope, config, em, authorization } = fixture({ config: { tenantId: null } })
    const result = await service.createUser({ userName: 'new@example.com' }, scope, baseUrl)
    expect(result.status).toBe(201)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, SsoConfig, {
      id: 'config-1', organizationId: 'org-1', tenantId: null, isActive: true, deletedAt: null,
    }, { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: null, organizationId: 'org-1' })
    expect(authorization.assertConfiguration).toHaveBeenCalledWith(em, config, undefined, 'token-author')
    expect(authorization.assertAccount).not.toHaveBeenCalled()
    expect(em.create).toHaveBeenCalledWith(User, expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }))
    expect(em.create).toHaveBeenCalledWith(SsoIdentity, expect.objectContaining({ tenantId: null, userId: 'new-user' }))
    expect(authorization.assertConfiguration.mock.invocationCallOrder[0]).toBeLessThan(em.create.mock.invocationCallOrder[0])
  })

  it('does not persist a new user after either author loses provisioning authority', async () => {
    const { service, scope, em, authorization } = fixture()
    authorization.assertConfiguration.mockRejectedValue(forbidden('sso.errors.authorizationDenied'))
    await expect(service.createUser({ userName: 'new@example.com' }, scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses email linking to a protected account before any identity or deactivation write', async () => {
    const { service, scope, user, config, em, authorization } = fixture({ existingUser: true })
    authorization.assertAccount.mockRejectedValue(forbidden('sso.errors.authorizationDenied'))
    await expect(service.createUser({ userName: user.email, active: false }, scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(authorization.assertAccount).toHaveBeenCalledWith(em, config, user, 'token-author')
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })

  it('links an ordinary account only after checking config and token authority together', async () => {
    const { service, scope, user, em, authorization } = fixture({ existingUser: true })
    const result = await service.createUser({ userName: user.email }, scope, baseUrl)
    expect(result.status).toBe(201)
    expect(authorization.assertAccount).toHaveBeenCalledTimes(1)
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
    expect(em.create).toHaveBeenCalledWith(SsoIdentity, expect.objectContaining({ userId: user.id }))
    expect(authorization.assertAccount.mock.invocationCallOrder[0]).toBeLessThan(em.create.mock.invocationCallOrder[0])
  })

  it('does not bypass target checks through externalId idempotency', async () => {
    const { service, scope, em, authorization } = fixture({ existingUser: true, existingIdentity: true })
    authorization.assertAccount.mockRejectedValue(forbidden('sso.errors.authorizationDenied'))
    await expect(service.createUser({ userName: 'staff@example.com', externalId: 'staff-id' }, scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(authorization.assertAccount).toHaveBeenCalledTimes(1)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('denies PATCH before changing protected account fields or deleting its sessions', async () => {
    const { service, scope, user, em, authorization } = fixture({ existingUser: true, existingIdentity: true })
    authorization.assertAccount.mockRejectedValue(forbidden('sso.errors.authorizationDenied'))
    await expect(service.patchUser('identity-1', [
      { op: 'replace', path: 'displayName', value: 'Changed Name' },
      { op: 'replace', path: 'active', value: false },
    ], scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(user.name).toBe('Original Name')
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })

  it('keeps authorized PATCH and deactivation in the same transaction', async () => {
    const { service, scope, user, em, authorization } = fixture({ existingUser: true, existingIdentity: true })
    const result = await service.patchUser('identity-1', [
      { op: 'replace', path: 'displayName', value: 'Changed Name' },
      { op: 'replace', path: 'active', value: false },
    ], scope, baseUrl)
    expect(result.active).toBe(false)
    expect(user.name).toBe('Changed Name')
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(authorization.assertAccount).toHaveBeenCalledTimes(1)
    expect(lockAuthorizationUserRows).toHaveBeenCalledWith(em, [user.id])
    expect(em.nativeDelete).toHaveBeenCalledWith(Session, { user: user.id })
  })

  it('denies DELETE for a protected target before revoking sessions', async () => {
    const { service, scope, em, authorization } = fixture({ existingUser: true, existingIdentity: true })
    authorization.assertAccount.mockRejectedValue(forbidden('sso.errors.authorizationDenied'))
    await expect(service.deleteUser('identity-1', scope)).rejects.toMatchObject({ status: 403 })
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects mismatched organization scope before resolving a target', async () => {
    const { service, scope, em, authorization } = fixture({ config: { organizationId: 'other-org' } })
    await expect(service.createUser({ userName: 'new@example.com' }, scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(authorization.assertAccount).not.toHaveBeenCalled()
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects a config changed back to JIT after the request context was resolved', async () => {
    const { service, scope, em, authorization } = fixture({ config: { jitEnabled: true } })
    await expect(service.createUser({ userName: 'new@example.com' }, scope, baseUrl)).rejects.toMatchObject({ status: 403 })
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })
})
