import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { POST } from '@open-mercato/core/modules/auth/api/login'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { compare } from 'bcryptjs'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoConfig, SsoUserDeactivation } from '../../data/entities'
import { SsoAuthService } from '../ssoAuthService'
import { register } from '../../di'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/core/modules/auth/lib/tenantEligibility', () => ({
  isStaffTenantActive: jest.fn(async () => true),
}))
jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: jest.fn(async () => ({ error: null, compoundKey: null })),
}))
jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: jest.fn(async () => undefined),
}))
jest.mock('bcryptjs', () => ({ compare: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../lib/oidc-provider', () => ({ OidcProvider: class { protocol = 'oidc' } }))

const STORED_HASH = '$2b$10$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0'
const user = {
  id: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', passwordHash: STORED_HASH,
} as User
const em = {} as EntityManager

describe('SSO-scoped password verification', () => {
  beforeEach(() => {
    jest.mocked(createRequestContainer).mockReset()
    jest.mocked(compare).mockReset()
    jest.mocked(compare).mockImplementation(async () => true)
    jest.mocked(findOneWithDecryption).mockReset()
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  })

  it.each([true, false])('checks the active account scope when bcrypt returns %s', async (verified) => {
    jest.mocked(compare).mockImplementation(async () => verified)

    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).resolves.toBe(verified)

    expect(compare).toHaveBeenCalledTimes(1)
    expect(compare).toHaveBeenCalledWith('password', STORED_HASH)
    expect(findOneWithDecryption).toHaveBeenCalledTimes(4)
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      1, em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      2, em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: null, organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(jest.mocked(compare).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(findOneWithDecryption).mock.invocationCallOrder[0],
    )
  })

  it.each([true, false])('denies a scoped deactivated account when bcrypt returns %s', async (verified) => {
    jest.mocked(compare).mockImplementation(async () => verified)
    jest.mocked(findOneWithDecryption).mockResolvedValue({ id: 'deactivation-1' } as SsoUserDeactivation)

    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).resolves.toBe(false)

    expect(compare).toHaveBeenCalledWith('password', STORED_HASH)
    expect(findOneWithDecryption).toHaveBeenCalledTimes(4)
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it.each([true, false])('checks legacy deactivation ownership when bcrypt returns %s', async (verified) => {
    jest.mocked(compare).mockImplementation(async () => verified)
    jest.mocked(findOneWithDecryption)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'legacy-1', ssoConfigId: 'config-1' } as SsoUserDeactivation)
      .mockResolvedValueOnce({ id: 'org-1' } as Organization)
      .mockResolvedValueOnce({ id: 'config-1' } as SsoConfig)

    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).resolves.toBe(false)

    expect(compare).toHaveBeenCalledWith('password', STORED_HASH)
    expect(findOneWithDecryption).toHaveBeenCalledTimes(4)
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      1, em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      2, em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: null, organizationId: 'org-1', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      3, em, Organization, { id: 'org-1', tenant: 'tenant-1' },
      { fields: ['id'] }, { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      4, em, SsoConfig, { id: 'config-1', organizationId: 'org-1', tenantId: null },
      { fields: ['id'] }, { tenantId: null, organizationId: 'org-1' },
    )
  })

  it('registers the scoped verifier under the authService used by the core login route', async () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })
    register(container)
    jest.mocked(findOneWithDecryption).mockResolvedValue({ id: 'deactivation-1' } as SsoUserDeactivation)
    const service = container.resolve<SsoAuthService>('authService')

    expect(service).toBeInstanceOf(SsoAuthService)
    await expect(service.verifyPassword(user, 'password')).resolves.toBe(false)
  })

  it.each([true, false])('keeps unknown-user bcrypt and scoped sentinel reads when bcrypt returns %s', async (verified) => {
    jest.mocked(compare).mockImplementation(async () => verified)

    await expect(new SsoAuthService(em).verifyPassword(null, 'password')).resolves.toBe(false)

    expect(compare).toHaveBeenCalledTimes(1)
    expect(compare).toHaveBeenCalledWith('password', expect.stringMatching(/^\$2[aby]\$10\$/))
    expect(findOneWithDecryption).toHaveBeenCalledTimes(4)
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(
      1, em, SsoUserDeactivation,
      {
        userId: '00000000-0000-0000-0000-000000000000',
        tenantId: '00000000-0000-0000-0000-000000000000',
        organizationId: '00000000-0000-0000-0000-000000000000',
        reactivatedAt: null,
      },
      {}, {
        tenantId: '00000000-0000-0000-0000-000000000000',
        organizationId: '00000000-0000-0000-0000-000000000000',
      },
    )
  })

  describe.each([true, false])('fixed eligibility schedule when bcrypt returns %s', (verified) => {
    it.each([
      { name: 'unknown', account: null, results: [null, null, null, null], deactivated: false },
      { name: 'passwordless', account: { ...user, passwordHash: null }, results: [null, null, null, null], deactivated: false },
      { name: 'active', account: user, results: [null, null, null, null], deactivated: false },
      { name: 'scoped deactivation', account: user, results: [{ id: 'marker-1' }, null, null, null], deactivated: true },
      {
        name: 'legacy deactivation', account: user,
        results: [null, { ssoConfigId: 'config-1' }, { id: 'org-1' }, { id: 'config-1' }], deactivated: true,
      },
      {
        name: 'unowned legacy scope', account: user,
        results: [null, { ssoConfigId: 'config-1' }, null, { id: 'config-1' }], deactivated: false,
      },
      { name: 'organization missing', account: { ...user, organizationId: null }, results: [null, null, null, null], deactivated: false },
      { name: 'tenant missing', account: { ...user, tenantId: null }, results: [null, null, null, null], deactivated: false },
    ])('uses identical query shapes for $name', async ({ account, results, deactivated }) => {
      jest.mocked(compare).mockImplementation(async () => verified)
      for (const result of results) {
        jest.mocked(findOneWithDecryption).mockResolvedValueOnce(result)
      }

      await expect(new SsoAuthService(em).verifyPassword(account as User | null, 'password')).resolves.toBe(
        Boolean(account?.passwordHash && verified && !deactivated),
      )

      expect(findOneWithDecryption).toHaveBeenCalledTimes(4)
      expect(jest.mocked(findOneWithDecryption).mock.calls.map((call) => ({
        entity: call[1],
        fields: Object.keys(call[2]).sort((left, right) => left.localeCompare(right)),
      }))).toEqual([
        { entity: SsoUserDeactivation, fields: ['organizationId', 'reactivatedAt', 'tenantId', 'userId'] },
        { entity: SsoUserDeactivation, fields: ['organizationId', 'reactivatedAt', 'tenantId', 'userId'] },
        { entity: Organization, fields: ['id', 'tenant'] },
        { entity: SsoConfig, fields: ['id', 'organizationId', 'tenantId'] },
      ])
    })
  })

  it.each([true, false])('denies a passwordless resolved account when bcrypt returns %s', async (verified) => {
    jest.mocked(compare).mockImplementation(async () => verified)

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
      container.register({ em: asValue(em) })
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
  })
})
