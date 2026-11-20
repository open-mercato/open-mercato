import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { compare } from 'bcryptjs'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoUserDeactivation } from '../../data/entities'
import { SsoAuthService } from '../ssoAuthService'
import { register } from '../../di'

jest.mock('bcryptjs', () => ({ compare: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../lib/oidc-provider', () => ({ OidcProvider: class { protocol = 'oidc' } }))

const user = {
  id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', passwordHash: 'stored-hash',
} as User
const em = {} as EntityManager

describe('SSO-scoped password verification', () => {
  beforeEach(() => {
    jest.mocked(compare).mockReset()
    jest.mocked(compare).mockImplementation(async () => true)
    jest.mocked(findOneWithDecryption).mockReset()
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  })

  it('denies a correct password while a deactivation is outstanding in the account scope', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue({ id: 'deactivation-1' } as SsoUserDeactivation)

    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).resolves.toBe(false)

    expect(compare).toHaveBeenCalledWith('password', 'stored-hash')
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('applies scoped deactivation eligibility to delegated credentials', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue({ id: 'deactivation-1' } as SsoUserDeactivation)
    const service = new SsoAuthService(em)

    await expect(service.isUserSessionEligible({ userId: user.id, tenantId: user.tenantId ?? null, organizationId: user.organizationId ?? null })).resolves.toBe(false)
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('allows a correct password when no outstanding deactivation matches the account scope', async () => {
    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).resolves.toBe(true)
  })

  it('registers the scoped verifier under the authService used by the core login route', async () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em), rbacService: asValue({}) })
    register(container)
    jest.mocked(findOneWithDecryption).mockResolvedValue({ id: 'deactivation-1' } as SsoUserDeactivation)
    const service = container.resolve<SsoAuthService>('authService')

    expect(service).toBeInstanceOf(SsoAuthService)
    await expect(service.verifyPassword(user, 'password')).resolves.toBe(false)
  })

  it('keeps bcrypt verification for unknown users without querying deactivation state', async () => {
    await expect(new SsoAuthService(em).verifyPassword(null, 'password')).resolves.toBe(false)

    expect(compare).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects incorrect passwords without querying deactivation state', async () => {
    jest.mocked(compare).mockImplementation(async () => false)

    await expect(new SsoAuthService(em).verifyPassword(user, 'incorrect')).resolves.toBe(false)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('fails closed when deactivation state cannot be read', async () => {
    jest.mocked(findOneWithDecryption).mockRejectedValue(new Error('[internal] database unavailable'))

<<<<<<< HEAD
    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).rejects.toThrow('database unavailable')
=======
    await expect(new SsoAuthService(em).verifyPassword({ ...user, passwordHash: null }, 'password')).resolves.toBe(false)

    expect(compare).toHaveBeenCalledTimes(1)
    expect(compare).toHaveBeenCalledWith('password', expect.stringMatching(/^\$2[aby]\$10\$/))
    expect(findOneWithDecryption).toHaveBeenCalledTimes(4)
  })

  describe.each([true, false])('when bcrypt returns %s', (verified) => {
    it.each([1, 2, 3, 4].flatMap((failedRead) => [user, null].map((account) => ({ failedRead, account }))))(
      'fails closed when eligibility read $failedRead fails for $account', async ({ failedRead, account }) => {
        jest.mocked(compare).mockImplementation(async () => verified)
        const lookupError = new Error('[internal] database unavailable')
        const precedingResults = [
          null,
          { id: 'legacy-1', ssoConfigId: 'config-1' } as SsoUserDeactivation,
          { id: 'org-1' } as Organization,
        ]
        for (const result of precedingResults.slice(0, failedRead - 1)) {
          jest.mocked(findOneWithDecryption).mockResolvedValueOnce(result)
        }
        jest.mocked(findOneWithDecryption).mockRejectedValueOnce(lookupError)

        await expect(new SsoAuthService(em).verifyPassword(account, 'password')).rejects.toBe(lookupError)

        expect(compare).toHaveBeenCalledTimes(1)
        expect(findOneWithDecryption).toHaveBeenCalledTimes(failedRead)
      },
    )
  })

  describe('core login route with the registered SSO verifier', () => {
    it.each([
      { verified: false, deactivated: false, resolved: true, reads: 4, ambiguous: false },
      { verified: false, deactivated: true, resolved: true, reads: 4, ambiguous: false },
      { verified: true, deactivated: true, resolved: true, reads: 4, ambiguous: false },
      { verified: false, deactivated: false, resolved: false, reads: 4, ambiguous: false },
      { verified: false, deactivated: false, resolved: false, reads: 4, ambiguous: true },
    ])('returns the same public denial for $verified/$deactivated/$resolved', async ({ verified, deactivated, resolved, reads, ambiguous }) => {
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({ em: asValue(em), rbacService: asValue({}) })
      register(container)
      const service = container.resolve<SsoAuthService>('authService')
      const accounts = resolved ? [user] : []
      if (ambiguous) accounts.push(user, { ...user, id: 'user-2', tenantId: 'tenant-2' })
      const lookup = jest.spyOn(service, 'findUsersByEmail').mockResolvedValue(accounts)
      const createSession = jest.spyOn(service, 'createSession')
      jest.mocked(createRequestContainer).mockResolvedValue(container)
      jest.mocked(compare).mockImplementation(async () => verified)
      if (deactivated) {
        jest.mocked(findOneWithDecryption).mockResolvedValue({ id: 'deactivation-1' } as SsoUserDeactivation)
      }

      try {
        const response = await POST(new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: 'sso-timing@example.com', password: 'password' }),
        }))

        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({ ok: false, error: 'Invalid email or password' })
        expect(response.headers.get('set-cookie')).toBeNull()
        expect(createSession).not.toHaveBeenCalled()
        expect(compare).toHaveBeenCalledTimes(1)
        expect(findOneWithDecryption).toHaveBeenCalledTimes(reads)
      } finally {
        lookup.mockRestore()
        createSession.mockRestore()
      }
    })
>>>>>>> b69e252f3f (fix(sso): enforce author privilege ceilings for SSO and SCIM (#10070))
  })
})
