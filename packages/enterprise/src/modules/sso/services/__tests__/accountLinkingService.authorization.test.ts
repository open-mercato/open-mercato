import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoConfig, SsoIdentity } from '../../data/entities'
import { AccountLinkingService } from '../accountLinkingService'
import type { SsoAuthorizationService } from '../ssoAuthorizationService'
import { emitSsoEvent } from '../../events'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../../events', () => ({ emitSsoEvent: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const version = new Date('2026-11-15T00:00:00.000Z')
const payload = { subject: 'subject-1', email: 'user@example.com', emailVerified: true }

function fixture(linked = true) {
  const config = {
    id: 'config-1', tenantId: null, organizationId: 'org-1', isActive: true,
    updatedAt: version, appRoleMappings: {}, allowedDomains: ['example.com'],
    autoLinkByEmail: true, jitEnabled: true, authorizationUserId: 'author-1',
  } as SsoConfig
  const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' } as User
  const identity = { id: 'identity-1', userId: user.id, lastLoginAt: null } as SsoIdentity
  const authorization = {
    resolveTenant: jest.fn(async () => 'tenant-1'),
    authorizeAccount: jest.fn(async () => ({ tenantId: 'tenant-1', mappedRoleIds: ['role-employee'] })),
    assertConfiguration: jest.fn(async () => 'tenant-1'),
  }
  const em = {
    transactional: jest.fn(async (callback: (manager: EntityManager) => Promise<unknown>) => callback(em as unknown as EntityManager)),
    create: jest.fn(), persist: jest.fn(), flush: jest.fn(), find: jest.fn(),
    count: jest.fn(async () => 0),
  }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => {
    if (entity === SsoConfig) return config
    if (entity === SsoIdentity) return linked ? identity : null
    if (entity === User) return user
    return null
  })
  return {
    config, user, identity, em, authorization,
    service: new AccountLinkingService(em as unknown as EntityManager, authorization as unknown as SsoAuthorizationService),
  }
}

describe('SSO account authority enforcement', () => {
  beforeEach(() => {
    jest.mocked(findOneWithDecryption).mockReset()
    jest.mocked(emitSsoEvent).mockClear()
    mockReportError.mockReset()
  })

  it.each([true, false])('refuses an unauthorized existing account before identity or role writes (linked=%s)', async (linked) => {
    const { service, config, user, em, identity, authorization } = fixture(linked)
    const denial = new Error('[internal] Target exceeds config authority')
    authorization.authorizeAccount.mockRejectedValueOnce(denial)

    await expect(service.resolveUser(config, payload, '')).rejects.toBe(denial)

    expect(authorization.authorizeAccount).toHaveBeenCalledWith(em, config, user)
    expect(identity.lastLoginAt).toBeNull()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('resolves nullable configuration tenants before scoped account lookup', async () => {
    const { service, config, user, identity, em, authorization } = fixture()

    await expect(service.resolveUser(config, payload, '')).resolves.toEqual({ user, identity })

    expect(authorization.resolveTenant).toHaveBeenCalledWith(em, config)
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, User, {
      id: user.id, tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null,
    }, {}, { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, SsoConfig, {
      id: config.id, organizationId: 'org-1', isActive: true, deletedAt: null,
    }, { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: null, organizationId: 'org-1' })
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
  })

  it('rejects an in-flight assertion when the provider config version changed', async () => {
    const { service, config, em, authorization } = fixture()

    await expect(service.resolveUser(config, payload, '', version.getTime() - 1)).rejects.toThrow('configuration changed')

    expect(authorization.resolveTenant).not.toHaveBeenCalled()
    expect(authorization.authorizeAccount).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('refuses a tenant supplied outside the configuration organization', async () => {
    const { service, config, em, authorization } = fixture()

    await expect(service.resolveUser(config, payload, 'other-tenant')).rejects.toThrow('tenant scope')

    expect(authorization.authorizeAccount).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('fails closed without a registered authorization service', async () => {
    const { config, em } = fixture()
    const service = new AccountLinkingService(em as unknown as EntityManager)

    await expect(service.resolveUser(config, payload, '')).rejects.toThrow('authorization service is unavailable')

    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('refuses JIT persistence when legacy configuration authority is missing', async () => {
    const { config, em, service, authorization } = fixture(false)
    jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => entity === SsoConfig ? config : null)
    authorization.assertConfiguration.mockRejectedValueOnce(new Error('[internal] Missing config author'))

    await expect(service.resolveUser(config, payload, '')).rejects.toThrow('Missing config author')

    expect(authorization.assertConfiguration).toHaveBeenCalledWith(em, config)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it.each(['email', 'jit'])('does not emit an identity event when the outer %s transaction fails to commit', async (flow) => {
    const { config, em, service, user } = fixture(false)
    config.autoLinkByEmail = flow === 'email'
    const commitError = new Error('[internal] Commit failed')
    em.create.mockImplementation((entity: unknown, data: Record<string, unknown>) =>
      entity === User ? { ...data, ...user } : { id: 'identity-created', ...data })
    em.persist.mockReturnValue({ flush: em.flush })
    em.transactional.mockImplementationOnce(async (callback) => {
      await callback(em as unknown as EntityManager)
      throw commitError
    })

    await expect(service.resolveUser(config, payload, '')).rejects.toBe(commitError)

    expect(em.persist).toHaveBeenCalled()
    expect(emitSsoEvent).not.toHaveBeenCalled()
  })

  it.each(['email', 'jit'])('emits one identity event only after the %s transaction commits', async (flow) => {
    const { config, em, service, user } = fixture(false)
    config.autoLinkByEmail = flow === 'email'
    const committed = jest.fn()
    em.create.mockImplementation((entity: unknown, data: Record<string, unknown>) =>
      entity === User ? { ...data, ...user } : { id: 'identity-created', ...data })
    em.persist.mockReturnValue({ flush: em.flush })
    em.transactional.mockImplementationOnce(async (callback) => {
      const result = await callback(em as unknown as EntityManager)
      expect(emitSsoEvent).not.toHaveBeenCalled()
      committed()
      return result
    })

    await service.resolveUser(config, payload, '')

    expect(emitSsoEvent).toHaveBeenCalledTimes(1)
    expect(emitSsoEvent).toHaveBeenCalledWith(flow === 'email' ? 'sso.identity.linked' : 'sso.identity.created', {
      id: 'identity-created', tenantId: 'tenant-1', organizationId: 'org-1',
    })
    expect(jest.mocked(emitSsoEvent).mock.invocationCallOrder[0]).toBeGreaterThan(committed.mock.invocationCallOrder[0])
  })

  it('preserves a committed link when event emission and its telemetry reporter both fail', async () => {
    const { config, em, service } = fixture(false)
    const eventError = new Error('[internal] Event delivery failed')
    const telemetryError = new Error('[internal] Telemetry bridge failed')
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: 'identity-created', ...data }))
    em.persist.mockReturnValue({ flush: em.flush })
    jest.mocked(emitSsoEvent).mockRejectedValueOnce(eventError)
    mockReportError.mockImplementationOnce(() => { throw telemetryError })
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      await expect(service.resolveUser(config, payload, '')).resolves.toHaveProperty('identity.id', 'identity-created')
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(mockReportError).toHaveBeenCalledWith(eventError, { module: 'sso', code: 'sso.event_emit_failed' })
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })
})
