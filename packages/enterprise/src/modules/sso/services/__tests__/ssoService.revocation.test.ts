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
})
