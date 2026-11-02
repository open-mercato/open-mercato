/** @jest-environment node */
import { hash as bcryptHash } from 'bcryptjs'
import {
  DEFAULT_ARGON2ID_PARAMS,
  createPasswordHasher,
  detectPasswordHashAlgorithm,
  getPasswordHasher,
  resolvePasswordHasherConfig,
  setPasswordHasher,
  type PasswordHasher,
  type PasswordHasherConfig,
} from '../passwordHasher'

// Cheap Argon2id parameters keep the suite fast; production defaults are asserted separately.
const FAST_ARGON2 = { memoryCost: 1024, timeCost: 1, parallelism: 1 }

function config(overrides: Partial<PasswordHasherConfig> = {}): PasswordHasherConfig {
  return {
    algorithm: 'bcrypt',
    bcryptCost: 4,
    argon2id: { ...FAST_ARGON2 },
    ...overrides,
  }
}

describe('resolvePasswordHasherConfig', () => {
  it('defaults to bcrypt cost 10 with OWASP Argon2id parameters', () => {
    expect(resolvePasswordHasherConfig({} as NodeJS.ProcessEnv)).toEqual({
      algorithm: 'bcrypt',
      bcryptCost: 10,
      argon2id: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
    })
    expect(DEFAULT_ARGON2ID_PARAMS).toEqual({ memoryCost: 19456, timeCost: 2, parallelism: 1 })
  })

  it('reads the algorithm and Argon2id parameters from env', () => {
    const resolved = resolvePasswordHasherConfig({
      OM_PASSWORD_HASH: ' Argon2id ',
      OM_PASSWORD_ARGON2_MEMORY_KIB: '65536',
      OM_PASSWORD_ARGON2_TIME_COST: '3',
      OM_PASSWORD_ARGON2_PARALLELISM: '4',
    } as NodeJS.ProcessEnv)
    expect(resolved.algorithm).toBe('argon2id')
    expect(resolved.argon2id).toEqual({ memoryCost: 65536, timeCost: 3, parallelism: 4 })
  })

  it('falls back to bcrypt for an unsupported algorithm and to defaults for invalid numbers', () => {
    const resolved = resolvePasswordHasherConfig({
      OM_PASSWORD_HASH: 'md5',
      OM_PASSWORD_ARGON2_MEMORY_KIB: 'lots',
      OM_PASSWORD_ARGON2_TIME_COST: '0',
    } as NodeJS.ProcessEnv)
    expect(resolved.algorithm).toBe('bcrypt')
    expect(resolved.argon2id.memoryCost).toBe(19456)
    expect(resolved.argon2id.timeCost).toBe(1)
  })

  it('keeps Argon2id memory at the 8 KiB-per-lane minimum', () => {
    const resolved = resolvePasswordHasherConfig({
      OM_PASSWORD_ARGON2_MEMORY_KIB: '1',
      OM_PASSWORD_ARGON2_PARALLELISM: '2',
    } as NodeJS.ProcessEnv)
    expect(resolved.argon2id.memoryCost).toBe(16)
  })
})

describe('detectPasswordHashAlgorithm', () => {
  it.each([
    ['$2a$10$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0', 'bcrypt'],
    ['$2b$10$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0', 'bcrypt'],
    ['$2y$12$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0', 'bcrypt'],
    ['$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'argon2id'],
    ['$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', null],
    ['plaintext', null],
    ['', null],
    [null, null],
  ])('detects %p as %p', (stored, expected) => {
    expect(detectPasswordHashAlgorithm(stored as string | null)).toBe(expected)
  })
})

describe('createPasswordHasher', () => {
  it('hashes with bcrypt by default and verifies the right password only', async () => {
    const hasher = createPasswordHasher(config())
    const stored = await hasher.hash('Secret#1')
    expect(stored).toMatch(/^\$2[aby]\$04\$/)
    await expect(hasher.verify('Secret#1', stored)).resolves.toBe(true)
    await expect(hasher.verify('wrong', stored)).resolves.toBe(false)
  })

  it('hashes with Argon2id when configured and verifies the right password only', async () => {
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
    const stored = await hasher.hash('Secret#1')
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/)
    await expect(hasher.verify('Secret#1', stored)).resolves.toBe(true)
    await expect(hasher.verify('wrong', stored)).resolves.toBe(false)
  })

  it('verifies both hash kinds under either configuration', async () => {
    const bcryptStored = await bcryptHash('Secret#1', 4)
    const argonStored = await createPasswordHasher(config({ algorithm: 'argon2id' })).hash('Secret#1')
    for (const algorithm of ['bcrypt', 'argon2id'] as const) {
      const hasher = createPasswordHasher(config({ algorithm }))
      await expect(hasher.verify('Secret#1', bcryptStored)).resolves.toBe(true)
      await expect(hasher.verify('Secret#1', argonStored)).resolves.toBe(true)
      await expect(hasher.verify('wrong', bcryptStored)).resolves.toBe(false)
      await expect(hasher.verify('wrong', argonStored)).resolves.toBe(false)
    }
  })

  it('verifies a $2y$ bcrypt hash', async () => {
    const stored = (await bcryptHash('Secret#1', 4)).replace(/^\$2b\$/, '$2y$')
    await expect(createPasswordHasher(config()).verify('Secret#1', stored)).resolves.toBe(true)
  })

  it('never matches unknown or malformed hashes', async () => {
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
    await expect(hasher.verify('Secret#1', 'Secret#1')).resolves.toBe(false)
    await expect(hasher.verify('Secret#1', '$argon2i$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).resolves.toBe(false)
    await expect(hasher.verify('Secret#1', '$argon2id$garbage')).resolves.toBe(false)
  })

  describe('needsRehash', () => {
    const argonDefault = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g'

    it('never flags bcrypt hashes under the default bcrypt configuration', () => {
      const hasher = createPasswordHasher(config())
      expect(hasher.needsRehash('$2b$10$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0')).toBe(false)
      expect(hasher.needsRehash('$2a$08$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0')).toBe(false)
    })

    it('flags bcrypt hashes when Argon2id is configured', () => {
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
      expect(hasher.needsRehash('$2b$10$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0')).toBe(true)
    })

    it('flags Argon2id hashes when bcrypt is configured (rollback path)', () => {
      expect(createPasswordHasher(config()).needsRehash(argonDefault)).toBe(true)
    })

    it('flags Argon2id hashes whose parameters differ from the configuration', () => {
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
      expect(hasher.needsRehash(argonDefault)).toBe(false)
      expect(hasher.needsRehash('$argon2id$v=19$m=2048,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true)
      expect(hasher.needsRehash('$argon2id$v=19$m=1024,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true)
      expect(hasher.needsRehash('$argon2id$v=16$m=1024,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true)
    })

    it('does not flag hashes it cannot recognise', () => {
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
      expect(hasher.needsRehash('plaintext')).toBe(false)
      expect(hasher.needsRehash('$argon2id$garbage')).toBe(false)
    })
  })

  it('does not load Argon2 for bcrypt-only work', async () => {
    const loadArgon2 = jest.fn()
    const hasher = createPasswordHasher(config(), { loadArgon2 })
    const stored = await hasher.hash('Secret#1')
    await hasher.verify('Secret#1', stored)
    await hasher.equalizeTiming('Secret#1')
    hasher.needsRehash(stored)
    expect(loadArgon2).not.toHaveBeenCalled()
  })

  it('surfaces a missing Argon2 implementation instead of reporting a wrong password', async () => {
    const loadArgon2 = jest.fn(async () => {
      throw new Error('Argon2id password hashing needs the "@node-rs/argon2" package')
    })
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }), { loadArgon2 })
    await expect(hasher.hash('Secret#1')).rejects.toThrow('@node-rs/argon2')
    await expect(hasher.verify('Secret#1', '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).rejects.toThrow('@node-rs/argon2')
  })

  it('equalizes timing with a dummy verification of the configured algorithm', async () => {
    const argon2 = { hash: jest.fn(async () => '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'), verify: jest.fn(async () => false) }
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }), { loadArgon2: async () => argon2 })
    await hasher.equalizeTiming('Secret#1')
    await hasher.equalizeTiming('Other#2')
    expect(argon2.hash).toHaveBeenCalledTimes(1)
    expect(argon2.verify).toHaveBeenCalledTimes(2)
    expect(argon2.verify.mock.calls[1]).toEqual(['$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'Other#2'])
  })
})

describe('getPasswordHasher / setPasswordHasher', () => {
  afterEach(() => setPasswordHasher(null))

  it('returns one process-wide instance built from env', () => {
    expect(getPasswordHasher()).toBe(getPasswordHasher())
    expect(getPasswordHasher().algorithm).toBe('bcrypt')
  })

  it('lets an app plug in its own hasher', () => {
    const custom: PasswordHasher = {
      algorithm: 'bcrypt',
      hash: async () => 'custom',
      verify: async () => true,
      needsRehash: () => false,
      equalizeTiming: async () => undefined,
    }
    setPasswordHasher(custom)
    expect(getPasswordHasher()).toBe(custom)
  })
})
