/** @jest-environment node */
import { hash as bcryptHash } from 'bcryptjs'
import {
  createPasswordHasher,
  getPasswordHasher,
  setPasswordHasher,
  type PasswordHasher,
} from '@open-mercato/shared/lib/auth/passwordHasher'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

const FAST_ARGON2 = { memoryCost: 1024, timeCost: 1, parallelism: 1 }

function useHasher(algorithm: 'bcrypt' | 'argon2id'): PasswordHasher {
  const hasher = createPasswordHasher({ algorithm, bcryptCost: 4, argon2id: { ...FAST_ARGON2 } })
  setPasswordHasher(hasher)
  return hasher
}

function makeEm(affected = 1) {
  return { nativeUpdate: jest.fn(async () => affected) }
}

describe('AuthService.rehashPasswordIfNeeded', () => {
  afterEach(() => setPasswordHasher(null))

  it('keeps bcrypt hashes untouched under the default bcrypt configuration', async () => {
    delete process.env.OM_PASSWORD_HASH
    setPasswordHasher(null)
    expect(getPasswordHasher().algorithm).toBe('bcrypt')
    const em = makeEm()
    const user = {
      id: 'u1',
      tenantId: 't1',
      organizationId: 'o1',
      passwordHash: await bcryptHash('Secret#1', 4),
    }
    const svc = new AuthService(em as any)
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(false)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('upgrades a bcrypt hash to Argon2id after login with a compare-and-swap update', async () => {
    const hasher = useHasher('argon2id')
    const oldHash = await bcryptHash('Secret#1', 4)
    const em = makeEm()
    const user = { id: 'u1', tenantId: 't1', organizationId: 'o1', passwordHash: oldHash }
    const svc = new AuthService(em as any)

    await expect(svc.verifyPassword(user as any, 'Secret#1')).resolves.toBe(true)
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(true)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    const [, where, data] = em.nativeUpdate.mock.calls[0] as unknown as [unknown, Record<string, unknown>, Record<string, string>]
    expect(where).toEqual({
      id: 'u1',
      tenantId: 't1',
      organizationId: 'o1',
      passwordHash: oldHash,
    })
    expect(Object.keys(data)).toEqual(['passwordHash'])
    expect(data.passwordHash).toMatch(/^\$argon2id\$/)
    expect(user.passwordHash).toBe(oldHash)
    await expect(hasher.verify('Secret#1', data.passwordHash)).resolves.toBe(true)
    await expect(svc.verifyPassword(user as any, 'Secret#1')).resolves.toBe(true)
  })

  it('does not let a later managed-entity flush overwrite a concurrent password reset', async () => {
    useHasher('argon2id')
    const oldHash = await bcryptHash('Secret#1', 4)
    const user = { id: 'u1', tenantId: null, organizationId: null, passwordHash: oldHash }
    let persistedHash = oldHash
    const em = {
      nativeUpdate: jest.fn(async (
        _entity: unknown,
        where: Record<string, unknown>,
        data: Record<string, string>,
      ) => {
        if (where.passwordHash !== persistedHash) return 0
        persistedHash = data.passwordHash
        return 1
      }),
      flush: jest.fn(async () => {
        if (user.passwordHash !== oldHash) persistedHash = user.passwordHash
      }),
    }
    const svc = new AuthService(em as any)

    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(true)
    expect(em.nativeUpdate.mock.calls[0]?.[1]).toEqual({
      id: 'u1',
      tenantId: null,
      organizationId: null,
      passwordHash: oldHash,
    })

    const concurrentResetHash = await bcryptHash('Reset#2', 4)
    persistedHash = concurrentResetHash
    await em.flush()

    expect(user.passwordHash).toBe(oldHash)
    expect(persistedHash).toBe(concurrentResetHash)
  })

  it('does not overwrite a password changed concurrently', async () => {
    useHasher('argon2id')
    const oldHash = await bcryptHash('Secret#1', 4)
    const em = makeEm(0)
    const user = { id: 'u1', tenantId: 't1', organizationId: 'o1', passwordHash: oldHash }
    const svc = new AuthService(em as any)
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(false)
    expect(user.passwordHash).toBe(oldHash)
  })

  it('never throws when the rehash fails', async () => {
    useHasher('argon2id')
    const em = { nativeUpdate: jest.fn(async () => { throw new Error('db down') }) }
    const user = {
      id: 'u1',
      tenantId: 't1',
      organizationId: 'o1',
      passwordHash: await bcryptHash('Secret#1', 4),
    }
    const svc = new AuthService(em as any)
    await expect(svc.rehashPasswordIfNeeded(user as any, 'Secret#1')).resolves.toBe(false)
  })

  it('does nothing for a user without a password', async () => {
    useHasher('argon2id')
    const em = makeEm()
    const svc = new AuthService(em as any)
    await expect(svc.rehashPasswordIfNeeded({
      id: 'u1',
      tenantId: null,
      organizationId: null,
      passwordHash: null,
    } as any, 'x')).resolves.toBe(false)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })
})
