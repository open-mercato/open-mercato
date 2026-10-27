import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoConfig, SsoIdentity, SsoUserDeactivation } from '../../data/entities'
import { AccountLinkingService } from '../accountLinkingService'
import { SsoService } from '../ssoService'
import { resolveSsoCallbackErrorCode } from '../../lib/errors'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../events', () => ({ emitSsoEvent: jest.fn(async () => undefined) }))
jest.mock('../../lib/state-cookie', () => ({
  decryptStateCookie: jest.fn(() => ({ state: 'flow-state', configId: 'config-1' })),
}))
jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({ signJwt: jest.fn(() => 'signed-token') }))

const config = {
  id: 'config-1', protocol: 'oidc', tenantId: 'tenant-1', organizationId: 'org-1',
  allowedDomains: ['example.com'], autoLinkByEmail: true, appRoleMappings: {},
} as SsoConfig
const payload = { subject: 'subject-1', email: 'user@example.com', emailVerified: true }

function createFixture(overrides: Partial<SsoUserDeactivation> = {}, linked = true) {
  const identity = { id: 'identity-1', userId: 'user-1', lastLoginAt: null } as SsoIdentity
  const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' } as User
  const deactivation = {
    userId: user.id, tenantId: config.tenantId, organizationId: config.organizationId,
    ssoConfigId: config.id, reactivatedAt: null, ...overrides,
  }
  const em = {
    flush: jest.fn(async () => undefined),
    persist: jest.fn(), create: jest.fn(), transactional: jest.fn(),
  }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    if (entity === SsoConfig) return config
    if (entity === SsoIdentity) return linked ? identity : null
    if (entity === User) return user
    if (entity === SsoUserDeactivation) {
      const filters = where as Record<string, unknown>
      return Object.entries(filters).every(([key, value]) => deactivation[key as keyof typeof deactivation] === value)
        ? deactivation as SsoUserDeactivation : null
    }
    return null
  })
  return { em, identity, user, deactivation, service: new AccountLinkingService(em as unknown as EntityManager) }
}

describe('SCIM deactivation enforcement during account linking', () => {
  beforeEach(() => jest.mocked(findOneWithDecryption).mockReset())

  it('denies an existing identity before login timestamps or roles are updated', async () => {
    const { em, identity, service } = createFixture()

    await expect(service.resolveUser(config, payload, 'tenant-1')).rejects.toThrow('SSO identity is deactivated')

    expect(identity.lastLoginAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.transactional).not.toHaveBeenCalled()
    expect(findOneWithDecryption).toHaveBeenLastCalledWith(
      em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: 'config-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('prevents email relinking from bypassing an outstanding deactivation', async () => {
    const { em, service } = createFixture({}, false)

    await expect(service.resolveUser(config, payload, 'tenant-1')).rejects.toThrow('SSO identity is deactivated')

    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it.each([
    { tenantId: 'other-tenant' }, { organizationId: 'other-org' },
    { ssoConfigId: 'other-config' }, { userId: 'other-user' }, { reactivatedAt: new Date() },
  ])('preserves access when deactivation does not match: %j', async (overrides) => {
    const { identity, user, service } = createFixture(overrides)

    await expect(service.resolveUser(config, payload, 'tenant-1')).resolves.toEqual({ user, identity })
    expect(identity.lastLoginAt).toBeInstanceOf(Date)
  })

  it('allows reactivation and denies the identity again after a subsequent deactivation', async () => {
    const { service, deactivation } = createFixture()

    await expect(service.resolveUser(config, payload, 'tenant-1')).rejects.toThrow('deactivated')
    deactivation.reactivatedAt = new Date()
    await expect(service.resolveUser(config, payload, 'tenant-1')).resolves.toHaveProperty('user.id', 'user-1')
    deactivation.reactivatedAt = null
    await expect(service.resolveUser(config, payload, 'tenant-1')).rejects.toThrow('deactivated')
  })

  it('keeps the existing generic SSO callback error', () => {
    expect(resolveSsoCallbackErrorCode(new Error('[internal] SSO identity is deactivated'))).toBe('sso_failed')
  })

  it('prevents fresh SSO sessions until reactivation through the real callback and linking services', async () => {
    const { em, service: accountLinkingService, deactivation } = createFixture()
    const authService = {
      getUserRoles: jest.fn(async () => []), updateLastLoginAt: jest.fn(),
      createSession: jest.fn(async () => ({ session: { id: 'session-1' }, token: 'refresh-token' })),
    }
    const service = new SsoService(
      em as unknown as EntityManager,
      { resolve: () => ({ handleCallback: async () => payload }) } as never,
      accountLinkingService,
      {} as never,
      authService as never,
      { invalidateUserCache: jest.fn() } as never,
    )

    await expect(service.handleOidcCallback({ state: 'flow-state' }, 'cookie', 'https://app/callback')).rejects.toThrow('deactivated')
    expect(authService.createSession).not.toHaveBeenCalled()
    expect(authService.updateLastLoginAt).not.toHaveBeenCalled()
    expect(authService.getUserRoles).not.toHaveBeenCalled()

    deactivation.reactivatedAt = new Date()
    await expect(service.handleOidcCallback({ state: 'flow-state' }, 'cookie', 'https://app/callback')).resolves.toHaveProperty('token', 'signed-token')
    expect(authService.createSession).toHaveBeenCalledTimes(1)
  })
})
