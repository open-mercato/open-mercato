/** @jest-environment node */
import { hash as bcryptHash } from 'bcryptjs'
import {
  createPasswordHasher,
  setPasswordHasher,
} from '@open-mercato/shared/lib/auth/passwordHasher'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'

const FAST_ARGON2 = { memoryCost: 1024, timeCost: 1, parallelism: 1 }

function useHasher(algorithm: 'bcrypt' | 'argon2id') {
  setPasswordHasher(createPasswordHasher({ algorithm, bcryptCost: 4, argon2id: { ...FAST_ARGON2 } }))
}

function makeService(nativeUpdate: jest.Mock = jest.fn(async () => 1)) {
  const em = { nativeUpdate, create: jest.fn((_entity: unknown, data: unknown) => data) }
  return { svc: new CustomerUserService(em as any), em }
}

const scope = { tenantId: 't1', organizationId: 'o1' }

describe('CustomerUserService password hashing', () => {
  afterEach(() => setPasswordHasher(null))

  it('hashes new portal passwords with bcrypt by default', async () => {
    setPasswordHasher(null)
    delete process.env.OM_PASSWORD_HASH
    const { svc } = makeService()
    const user = await svc.createUser('a@example.com', 'Secret#1', 'A', scope)
    expect(user.passwordHash).toMatch(/^\$2[aby]\$10\$/)
    await expect(svc.verifyPassword(user, 'Secret#1')).resolves.toBe(true)
    await expect(svc.verifyPassword(user, 'wrong')).resolves.toBe(false)
  })

  it('hashes new portal passwords with Argon2id when configured', async () => {
    useHasher('argon2id')
    const { svc } = makeService()
    const user = await svc.createUser('a@example.com', 'Secret#1', 'A', scope)
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    await expect(svc.verifyPassword(user, 'Secret#1')).resolves.toBe(true)
  })

  it('keeps verifying existing bcrypt hashes after Argon2id is switched on', async () => {
    useHasher('argon2id')
    const { svc } = makeService()
    const user = { id: 'u1', ...scope, passwordHash: await bcryptHash('Secret#1', 4) }
    await expect(svc.verifyPassword(user as any, 'Secret#1')).resolves.toBe(true)
    await expect(svc.verifyPassword(user as any, 'wrong')).resolves.toBe(false)
  })

  it('upgrades a bcrypt hash to Argon2id with a tenant- and organization-scoped compare-and-swap', async () => {
    useHasher('argon2id')
    const { svc, em } = makeService()
    const oldHash = await bcryptHash('Secret#1', 4)
    const user = { id: 'u1', ...scope, passwordHash: oldHash }
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(true)
    const [, where, data] = em.nativeUpdate.mock.calls[0] as unknown as [unknown, Record<string, unknown>, Record<string, string>]
    expect(where).toEqual({
      id: 'u1',
      tenantId: 't1',
      organizationId: 'o1',
      passwordHash: oldHash,
    })
    expect(data.passwordHash).toMatch(/^\$argon2id\$/)
    expect(user.passwordHash).toBe(oldHash)
    await expect(createPasswordHasher({
      algorithm: 'argon2id',
      bcryptCost: 4,
      argon2id: { ...FAST_ARGON2 },
    }).verify('Secret#1', data.passwordHash)).resolves.toBe(true)
    await expect(svc.verifyPassword(user as any, 'Secret#1')).resolves.toBe(true)
  })

  it('writes nothing under the default bcrypt configuration', async () => {
    useHasher('bcrypt')
    const { svc, em } = makeService()
    const user = { id: 'u1', ...scope, passwordHash: await bcryptHash('Secret#1', 4) }
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(false)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('never throws when the rehash write fails', async () => {
    useHasher('argon2id')
    const { svc } = makeService(jest.fn(async () => { throw new Error('db down') }))
    const user = { id: 'u1', ...scope, passwordHash: await bcryptHash('Secret#1', 4) }
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(false)
  })
})
