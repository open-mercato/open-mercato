import { randomBytes } from 'node:crypto'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))
jest.mock('../../lib/state-cookie', () => ({
  decryptStateCookie: jest.fn(() => ({ state: 'flow-state', nonce: 'nonce', codeVerifier: 'verifier', configId: 'config-1', returnUrl: '/backend' })),
  encryptStateCookie: jest.fn(),
  createFlowState: jest.fn(),
}))
jest.mock('../../events', () => ({ emitSsoEvent: jest.fn(async () => undefined) }))

import { SsoService } from '../ssoService'
import { SsoRolesRevokedError } from '../../lib/errors'

describe('SsoService role revocation on denied login', () => {
  afterEach(() => jest.restoreAllMocks())

  it('drops cached RBAC for the user whose SSO roles were revoked before rethrowing the denial', async () => {
    findOneWithDecryption.mockResolvedValue({ id: 'config-1', protocol: 'oidc', tenantId: 'tenant-1', organizationId: 'org-1', clientSecretEnc: null })
    const denial = new SsoRolesRevokedError('user-1', 'No roles could be resolved from IdP groups — login denied.')
    const accountLinkingService = { resolveUser: jest.fn().mockRejectedValue(denial) }
    const rbacService = { invalidateUserCache: jest.fn(async () => undefined) }
    const provider = { handleCallback: jest.fn(async () => ({ subject: 'sub-1', email: 'user@example.com', emailVerified: true, groups: [] })) }
    const service = new SsoService(
      {} as never,
      { resolve: () => provider } as never,
      accountLinkingService as never,
      {} as never,
      {} as never,
      rbacService as never,
    )

    await expect(service.handleOidcCallback({ state: 'flow-state' }, 'cookie', 'https://app/callback')).rejects.toBe(denial)

    expect(rbacService.invalidateUserCache).toHaveBeenCalledWith('user-1')
  })

  it('does not touch the RBAC cache for unrelated callback failures', async () => {
    findOneWithDecryption.mockResolvedValue({ id: 'config-1', protocol: 'oidc', tenantId: 'tenant-1', organizationId: 'org-1', clientSecretEnc: null })
    const failure = new Error('IdP unavailable')
    const accountLinkingService = { resolveUser: jest.fn().mockRejectedValue(failure) }
    const rbacService = { invalidateUserCache: jest.fn(async () => undefined) }
    const provider = { handleCallback: jest.fn(async () => ({ subject: 'sub-1', email: 'user@example.com', emailVerified: true, groups: [] })) }
    const service = new SsoService(
      {} as never,
      { resolve: () => provider } as never,
      accountLinkingService as never,
      {} as never,
      {} as never,
      rbacService as never,
    )

    await expect(service.handleOidcCallback({ state: 'flow-state' }, 'cookie', 'https://app/callback')).rejects.toBe(failure)

    expect(rbacService.invalidateUserCache).not.toHaveBeenCalled()
  })

  it('retains the provider config version through account and final session checks', async () => {
    const now = new Date('2026-11-25T00:00:00.000Z')
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime())
    jest.replaceProperty(process, 'env', {
      ...process.env,
      JWT_SECRET: randomBytes(32).toString('hex'),
      REMEMBER_ME_DAYS: '5',
    })
    const originalVersion = new Date('2026-11-15T00:00:00.000Z')
    const config = {
      id: 'config-1', protocol: 'oidc', tenantId: null, organizationId: 'org-1',
      clientSecretEnc: null, updatedAt: originalVersion,
    }
    findOneWithDecryption.mockResolvedValue(config)
    const user = { id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', email: 'user@example.com' }
    const accountLinkingService = { resolveUser: jest.fn(async () => ({ user, identity: { id: 'identity-1' } })) }
    const authService = {
      getUserRoles: jest.fn(async () => ['employee']),
      updateLastLoginAt: jest.fn(),
      createSession: jest.fn(async () => ({ session: { id: 'session-1' }, token: 'refresh-token' })),
    }
    const provider = {
      handleCallback: jest.fn(async () => {
        config.updatedAt = new Date(originalVersion.getTime() + 1)
        return { subject: 'subject-1', email: user.email, emailVerified: true }
      }),
    }
    const service = new SsoService(
      {} as never,
      { resolve: () => provider } as never,
      accountLinkingService as never,
      {} as never,
      authService as never,
      { invalidateUserCache: jest.fn() } as never,
    )

    const login = await service.handleOidcCallback({ state: 'flow-state' }, 'cookie', 'https://app/callback')
    const expiresAt = new Date('2026-11-30T00:00:00.000Z')
    expect(login).toMatchObject({
      tenantId: 'tenant-1', sessionToken: 'refresh-token', sessionExpiresAt: expiresAt,
    })
    const claims = verifyAudienceJwt('staff', login.token)
    expect(claims).toMatchObject({
      sub: 'user-1', sid: 'session-1', tenantId: 'tenant-1', orgId: 'org-1', email: user.email, roles: ['employee'],
    })
    expect(claims?.exp - claims?.iat).toBe(8 * 60 * 60)
    expect(claims).not.toHaveProperty('mfa_pending')
    expect(verifyAudienceJwt('customer', login.token)).toBeNull()

    expect(accountLinkingService.resolveUser).toHaveBeenCalledWith(config,
      expect.objectContaining({ subject: 'subject-1' }), '', originalVersion.getTime())
    expect(authService.createSession).toHaveBeenCalledWith(user, expiresAt, {
      tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: config.id,
      configUpdatedAt: originalVersion.getTime(),
    })
    expect(authService.getUserRoles).toHaveBeenCalledWith(user, 'tenant-1')
  })
})
