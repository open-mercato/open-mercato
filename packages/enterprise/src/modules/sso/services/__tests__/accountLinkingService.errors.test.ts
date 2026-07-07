import type { EntityManager } from '@mikro-orm/postgresql'
import { AccountLinkingService } from '../accountLinkingService'
import { isEmailNotVerifiedError, resolveSsoCallbackErrorCode } from '../../lib/errors'
import type { SsoConfig } from '../../data/entities'
import type { SsoIdentityPayload } from '../../lib/types'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

const config = { id: 'cfg-1', organizationId: 'org-1' } as unknown as SsoConfig

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
