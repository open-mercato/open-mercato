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

function phcBase64(byteLength: number, fill: number): string {
  return Buffer.alloc(byteLength, fill).toString('base64').replace(/=+$/u, '')
}

function argon2Hash(
  params = FAST_ARGON2,
  salt = phcBase64(16, 1),
  output = phcBase64(32, 2),
): string {
  return `$argon2id$v=19$m=${params.memoryCost},t=${params.timeCost},p=${params.parallelism}$${salt}$${output}`
}

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

  it('accepts the documented Argon2id minima explicitly', () => {
    const resolved = resolvePasswordHasherConfig({
      OM_PASSWORD_ARGON2_MEMORY_KIB: '19456',
      OM_PASSWORD_ARGON2_TIME_COST: '2',
      OM_PASSWORD_ARGON2_PARALLELISM: '1',
    } as NodeJS.ProcessEnv)
    expect(resolved.argon2id).toEqual(DEFAULT_ARGON2ID_PARAMS)
  })

  it('falls back to bcrypt for an unsupported algorithm and to defaults for malformed numbers', () => {
    const resolved = resolvePasswordHasherConfig({
      OM_PASSWORD_HASH: 'md5',
      OM_PASSWORD_ARGON2_MEMORY_KIB: 'lots',
      OM_PASSWORD_ARGON2_TIME_COST: '2iterations',
      OM_PASSWORD_ARGON2_PARALLELISM: '1.5',
    } as NodeJS.ProcessEnv)
    expect(resolved.algorithm).toBe('bcrypt')
    expect(resolved.argon2id).toEqual(DEFAULT_ARGON2ID_PARAMS)
  })

  it.each([
    ['memory below the minimum', { OM_PASSWORD_ARGON2_MEMORY_KIB: '19455' }],
    ['memory above the maximum', { OM_PASSWORD_ARGON2_MEMORY_KIB: '4194305' }],
    ['time below the minimum', { OM_PASSWORD_ARGON2_TIME_COST: '1' }],
    ['time above the maximum', { OM_PASSWORD_ARGON2_TIME_COST: '101' }],
    ['parallelism below the minimum', { OM_PASSWORD_ARGON2_PARALLELISM: '0' }],
    ['parallelism above the maximum', { OM_PASSWORD_ARGON2_PARALLELISM: '256' }],
    ['an unsafe integer', { OM_PASSWORD_ARGON2_MEMORY_KIB: '9007199254740992' }],
  ])('falls back to the safe defaults for %s instead of clamping it', (_label, env) => {
    expect(resolvePasswordHasherConfig(env as NodeJS.ProcessEnv).argon2id).toEqual(DEFAULT_ARGON2ID_PARAMS)
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
    expect(hasher.needsRehash(stored)).toBe(false)
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

  it('never matches unknown or malformed hashes (non-Argon2id values go to bcrypt, as before)', async () => {
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
    await expect(hasher.verify('Secret#1', 'Secret#1')).resolves.toBe(false)
    await expect(hasher.verify('Secret#1', '$argon2i$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).resolves.toBe(false)
    await expect(hasher.verify('Secret#1', '$argon2id$garbage')).resolves.toBe(false)
    await expect(hasher.verify('Secret#1', '')).resolves.toBe(false)
  })

  describe('needsRehash', () => {
    const argonDefault = argon2Hash()

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
      expect(hasher.needsRehash(argon2Hash({ ...FAST_ARGON2, memoryCost: 2048 }))).toBe(true)
      expect(hasher.needsRehash(argon2Hash({ ...FAST_ARGON2, timeCost: 2 }))).toBe(true)
      expect(hasher.needsRehash(argonDefault.replace('$v=19$', '$v=16$'))).toBe(true)
    })

    it('accepts valid package hash dimensions and parameter ordering', () => {
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
      const reordered = argonDefault.replace('m=1024,t=1,p=1', 'p=1,m=1024,t=1')
      expect(hasher.needsRehash(argonDefault)).toBe(false)
      expect(hasher.needsRehash(reordered)).toBe(false)
      expect(hasher.needsRehash(argon2Hash(FAST_ARGON2, phcBase64(32, 3)))).toBe(false)
    })

    it.each([
      ['a salt shorter than 16 bytes', argon2Hash(FAST_ARGON2, phcBase64(15, 1))],
      ['an output shorter than 32 bytes', argon2Hash(FAST_ARGON2, phcBase64(16, 1), phcBase64(31, 2))],
      ['an output longer than 32 bytes', argon2Hash(FAST_ARGON2, phcBase64(16, 1), phcBase64(33, 2))],
      ['non-canonical salt base64', argon2Hash(FAST_ARGON2, 'AB')],
      ['non-base64 output', argon2Hash(FAST_ARGON2, phcBase64(16, 1), 'not_base64')],
      ['duplicate parameters', argonDefault.replace('m=1024,t=1,p=1', 'm=1024,m=1024,p=1')],
      ['missing parameters', argonDefault.replace('m=1024,t=1,p=1', 'm=1024,p=1')],
    ])('flags an Argon2id hash with %s', (_label, storedHash) => {
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
      expect(hasher.needsRehash(storedHash)).toBe(true)
    })

    it('does not flag unknown hashes but flags malformed Argon2id hashes', () => {
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }))
      expect(hasher.needsRehash('plaintext')).toBe(false)
      expect(hasher.needsRehash('$argon2id$garbage')).toBe(true)
    })
  })

  it('does not load Argon2 for successful bcrypt-only work', async () => {
    const loadArgon2 = jest.fn()
    const hasher = createPasswordHasher(config(), { loadArgon2 })
    const stored = await hasher.hash('Secret#1')
    await hasher.verify('Secret#1', stored)
    hasher.needsRehash(stored)
    expect(loadArgon2).not.toHaveBeenCalled()
  })

  it.each(['bcrypt', 'argon2id'] as const)(
    'adds an Argon2id dummy verification to failed bcrypt checks under %s configuration',
    async (algorithm) => {
      const timingHash = argon2Hash()
      const argon2 = {
        hash: jest.fn(async () => timingHash),
        verify: jest.fn(async () => false),
      }
      const hasher = createPasswordHasher(config({ algorithm }), { loadArgon2: async () => argon2 })
      const stored = await bcryptHash('Secret#1', 4)

      await expect(hasher.verify('wrong', stored)).resolves.toBe(false)

      expect(argon2.hash).toHaveBeenCalledTimes(1)
      expect(argon2.verify).toHaveBeenCalledWith(timingHash, 'wrong')
    },
  )

  it.each(['bcrypt', 'argon2id'] as const)(
    'preserves successful Argon2id verification and adds no Argon2id dummy under %s configuration',
    async (algorithm) => {
      const stored = argon2Hash()
      const argon2 = {
        hash: jest.fn(async () => argon2Hash()),
        verify: jest.fn(async (candidate: string) => candidate === stored),
      }
      const hasher = createPasswordHasher(config({ algorithm }), { loadArgon2: async () => argon2 })

      await expect(hasher.verify('Secret#1', stored)).resolves.toBe(true)

      expect(argon2.verify).toHaveBeenCalledTimes(1)
      expect(argon2.hash).not.toHaveBeenCalled()
    },
  )

  it.each(['bcrypt', 'argon2id'] as const)(
    'runs one real Argon2id check, initializes the timing hash, and adds bcrypt failure work under %s configuration',
    async (algorithm) => {
      const stored = argon2Hash()
      const timingHash = argon2Hash(FAST_ARGON2, phcBase64(16, 3), phcBase64(32, 4))
      const argon2 = {
        hash: jest.fn(async () => timingHash),
        verify: jest.fn(async () => false),
      }
      const hasher = createPasswordHasher(config({ algorithm }), { loadArgon2: async () => argon2 })

      await expect(hasher.verify('wrong', stored)).resolves.toBe(false)

      expect(argon2.verify).toHaveBeenCalledTimes(1)
      expect(argon2.verify).toHaveBeenCalledWith(stored, 'wrong')
      expect(argon2.hash).toHaveBeenCalledTimes(1)

      await expect(hasher.verify('wrong again', stored)).resolves.toBe(false)
      expect(argon2.verify).toHaveBeenCalledTimes(2)
      expect(argon2.hash).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['bcrypt', 'argon2id'] as const)(
    'keeps cold and warm Argon2id operation counts equal for failed and absent accounts under %s configuration',
    async (algorithm) => {
      const makeArgon2 = () => ({
        hash: jest.fn(async () => argon2Hash()),
        verify: jest.fn(async () => false),
      })
      const failedAccountArgon2 = makeArgon2()
      const absentAccountArgon2 = makeArgon2()
      const failedAccountHasher = createPasswordHasher(config({ algorithm }), {
        loadArgon2: async () => failedAccountArgon2,
      })
      const absentAccountHasher = createPasswordHasher(config({ algorithm }), {
        loadArgon2: async () => absentAccountArgon2,
      })

      await failedAccountHasher.verify('wrong', argon2Hash())
      await absentAccountHasher.equalizeTiming('wrong')
      expect(failedAccountArgon2.hash).toHaveBeenCalledTimes(1)
      expect(absentAccountArgon2.hash).toHaveBeenCalledTimes(1)
      expect(failedAccountArgon2.verify).toHaveBeenCalledTimes(1)
      expect(absentAccountArgon2.verify).toHaveBeenCalledTimes(1)

      await failedAccountHasher.verify('wrong again', argon2Hash())
      await absentAccountHasher.equalizeTiming('wrong again')
      expect(failedAccountArgon2.hash).toHaveBeenCalledTimes(1)
      expect(absentAccountArgon2.hash).toHaveBeenCalledTimes(1)
      expect(failedAccountArgon2.verify).toHaveBeenCalledTimes(2)
      expect(absentAccountArgon2.verify).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    ['malformed Argon2id', '$argon2id$garbage'],
    ['unknown', 'legacy-or-corrupted-hash'],
  ])('gives %s stored hashes the cold and warm dummy Argon2id profile', async (_label, storedHash) => {
    const timingHash = argon2Hash()
    const argon2 = {
      hash: jest.fn(async () => timingHash),
      verify: jest.fn(async () => false),
    }
    const hasher = createPasswordHasher(config(), { loadArgon2: async () => argon2 })

    await expect(hasher.verify('wrong', storedHash)).resolves.toBe(false)
    expect(argon2.hash).toHaveBeenCalledTimes(1)
    expect(argon2.verify).toHaveBeenCalledTimes(1)
    expect(argon2.verify).toHaveBeenLastCalledWith(timingHash, 'wrong')

    await expect(hasher.verify('wrong again', storedHash)).resolves.toBe(false)
    expect(argon2.hash).toHaveBeenCalledTimes(1)
    expect(argon2.verify).toHaveBeenCalledTimes(2)
    expect(argon2.verify).toHaveBeenLastCalledWith(timingHash, 'wrong again')
  })

  it('falls back to the dummy profile when a structurally valid Argon2id verification throws', async () => {
    const storedHash = argon2Hash()
    const timingHash = argon2Hash(FAST_ARGON2, phcBase64(16, 3), phcBase64(32, 4))
    const argon2 = {
      hash: jest.fn(async () => timingHash),
      verify: jest.fn(async (candidate: string) => {
        if (candidate === storedHash) throw new Error('verification failed')
        return false
      }),
    }
    const hasher = createPasswordHasher(config(), { loadArgon2: async () => argon2 })

    await expect(hasher.verify('wrong', storedHash)).resolves.toBe(false)
    expect(argon2.hash).toHaveBeenCalledTimes(1)
    expect(argon2.verify).toHaveBeenCalledTimes(2)
    expect(argon2.verify).toHaveBeenLastCalledWith(timingHash, 'wrong')
  })

  it('surfaces a missing Argon2 implementation instead of reporting a wrong password', async () => {
    const loadArgon2 = jest.fn(async () => {
      throw new Error('Argon2id password hashing needs the "@node-rs/argon2" package')
    })
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }), { loadArgon2 })
    await expect(hasher.hash('Secret#1')).rejects.toThrow('@node-rs/argon2')
    await expect(hasher.verify('Secret#1', '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).rejects.toThrow('@node-rs/argon2')
  })

  it.each(['bcrypt', 'argon2id'] as const)(
    'equalizes timing with cached Argon2id work as well as bcrypt under %s configuration',
    async (algorithm) => {
      const timingHash = argon2Hash()
      const argon2 = { hash: jest.fn(async () => timingHash), verify: jest.fn(async () => false) }
      const hasher = createPasswordHasher(config({ algorithm }), { loadArgon2: async () => argon2 })
      await hasher.equalizeTiming('Secret#1')
      await hasher.equalizeTiming('Other#2')
      expect(argon2.hash).toHaveBeenCalledTimes(1)
      expect(argon2.verify).toHaveBeenCalledTimes(2)
      expect(argon2.verify.mock.calls[1]).toEqual([timingHash, 'Other#2'])
    },
  )
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
