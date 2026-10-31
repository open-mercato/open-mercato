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

  it('allows a correct password when no outstanding deactivation matches the account scope', async () => {
    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).resolves.toBe(true)
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

    await expect(new SsoAuthService(em).verifyPassword(user, 'password')).rejects.toThrow('database unavailable')
  })
})
