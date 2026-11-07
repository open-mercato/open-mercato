/** @jest-environment node */
import { hash as bcryptHash } from 'bcryptjs'
import {
  DEFAULT_ARGON2ID_PARAMS,
  createPasswordHasher,
  detectPasswordHashAlgorithm,
  PasswordHasherBusyError,
  getPasswordHasher,
  isPasswordHasherBusyError,
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
      argon2Limits: { maxConcurrency: 4, maxQueue: 64 },
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

  it('reads the Argon2 work limits from env and falls back for invalid values', () => {
    expect(resolvePasswordHasherConfig({
      OM_PASSWORD_ARGON2_MAX_CONCURRENCY: '8',
      OM_PASSWORD_ARGON2_MAX_QUEUE: '200',
    } as NodeJS.ProcessEnv).argon2Limits).toEqual({ maxConcurrency: 8, maxQueue: 200 })
    expect(resolvePasswordHasherConfig({
      OM_PASSWORD_ARGON2_MAX_CONCURRENCY: '0',
      OM_PASSWORD_ARGON2_MAX_QUEUE: 'many',
    } as NodeJS.ProcessEnv).argon2Limits).toEqual({ maxConcurrency: 4, maxQueue: 64 })
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

  function fakeArgon2(timingHash = argon2Hash(FAST_ARGON2, phcBase64(16, 3), phcBase64(32, 4))) {
    return {
      timingHash,
      hash: jest.fn(async () => timingHash),
      verify: jest.fn(async (_candidate: string, _password: string) => false),
    }
  }

  function bcryptCompareCount(spy: jest.SpyInstance): number {
    return spy.mock.calls.length
  }

  it('never loads or runs Argon2 for any bcrypt-configured outcome on bcrypt or unknown hashes', async () => {
    const loadArgon2 = jest.fn()
    const hasher = createPasswordHasher(config(), { loadArgon2 })
    const stored = await hasher.hash('Secret#1')
    await expect(hasher.verify('Secret#1', stored)).resolves.toBe(true)
    await expect(hasher.verify('wrong', stored)).resolves.toBe(false)
    await expect(hasher.verify('wrong', 'legacy-or-corrupted-hash')).resolves.toBe(false)
    await expect(hasher.verify('wrong', '$argon2id$garbage')).resolves.toBe(false)
    await hasher.equalizeTiming('wrong')
    hasher.needsRehash(stored)
    expect(loadArgon2).not.toHaveBeenCalled()
  })

  describe('uniform work profile', () => {
    const bcryptjs = jest.requireActual<typeof import('bcryptjs')>('bcryptjs')
    let compareSpy: jest.SpyInstance

    beforeEach(() => {
      compareSpy = jest.spyOn(bcryptjs, 'compare')
    })

    afterEach(() => compareSpy.mockRestore())

    async function profileOf(
      algorithm: 'bcrypt' | 'argon2id',
      run: (hasher: PasswordHasher) => Promise<unknown>,
    ) {
      const argon2 = fakeArgon2()
      const storedArgon = argon2Hash()
      argon2.verify.mockImplementation(async (candidate: string, password: string) => candidate === storedArgon && password === 'Secret#1')
      const hasher = createPasswordHasher(config({ algorithm }), { loadArgon2: async () => argon2 })
      compareSpy.mockClear()
      await run(hasher)
      return { hash: argon2.hash.mock.calls.length, verify: argon2.verify.mock.calls.length, bcrypt: bcryptCompareCount(compareSpy), storedArgon }
    }

    it.each(['bcrypt', 'argon2id'] as const)(
      'spends identical cold-process work for match, mismatch, absent, malformed and unknown under %s',
      async (algorithm) => {
        const bcryptStored = await bcryptHash('Secret#1', 4)
        const expected = algorithm === 'argon2id' ? { hash: 1, verify: 1, bcrypt: 1 } : { hash: 0, verify: 0, bcrypt: 1 }
        const scenarios: Array<(hasher: PasswordHasher) => Promise<unknown>> = [
          (hasher) => hasher.verify('Secret#1', bcryptStored),
          (hasher) => hasher.verify('wrong', bcryptStored),
          (hasher) => hasher.equalizeTiming('wrong'),
          (hasher) => hasher.verify('wrong', 'legacy-or-corrupted-hash'),
          (hasher) => hasher.verify('wrong', '$argon2id$garbage'),
        ]
        for (const scenario of scenarios) {
          const profile = await profileOf(algorithm, scenario)
          expect({ hash: profile.hash, verify: profile.verify, bcrypt: profile.bcrypt }).toEqual(expected)
        }
      },
    )

    it('gives a correct and a wrong password on an Argon2id hash the same profile as an absent account', async () => {
      const storedArgon = argon2Hash()
      const correct = await profileOf('argon2id', (hasher) => hasher.verify('Secret#1', storedArgon))
      const wrong = await profileOf('argon2id', (hasher) => hasher.verify('wrong', storedArgon))
      const absent = await profileOf('argon2id', (hasher) => hasher.equalizeTiming('wrong'))
      expect(correct).toEqual(wrong)
      expect({ hash: correct.hash, verify: correct.verify, bcrypt: correct.bcrypt }).toEqual({ hash: absent.hash, verify: absent.verify, bcrypt: absent.bcrypt })
    })

    it('keeps warm-process work equal: the Argon2id timing hash is created once and reused', async () => {
      const argon2 = fakeArgon2()
      const stored = argon2Hash()
      const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }), { loadArgon2: async () => argon2 })
      await hasher.verify('wrong', stored)
      await hasher.equalizeTiming('wrong')
      await hasher.verify('wrong', await bcryptHash('Secret#1', 4))
      expect(argon2.hash).toHaveBeenCalledTimes(1)
      expect(argon2.verify).toHaveBeenCalledTimes(3)
      expect(argon2.verify).toHaveBeenCalledWith(stored, 'wrong')
      expect(argon2.verify).toHaveBeenCalledWith(argon2.timingHash, 'wrong')
    })
  })

  it('still verifies a legacy Argon2id hash after rolling back to bcrypt', async () => {
    const stored = argon2Hash()
    const argon2 = fakeArgon2()
    argon2.verify.mockImplementation(async (candidate: string) => candidate === stored)
    const hasher = createPasswordHasher(config(), { loadArgon2: async () => argon2 })
    await expect(hasher.verify('Secret#1', stored)).resolves.toBe(true)
    expect(argon2.hash).not.toHaveBeenCalled()
  })

  it('treats a throwing Argon2id verification as a mismatch and still spends the dummy verification', async () => {
    const storedHash = argon2Hash()
    const argon2 = fakeArgon2()
    argon2.verify.mockImplementation(async (candidate: string) => {
      if (candidate === storedHash) throw new Error('verification failed')
      return false
    })
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }), { loadArgon2: async () => argon2 })
    await expect(hasher.verify('wrong', storedHash)).resolves.toBe(false)
    expect(argon2.hash).toHaveBeenCalledTimes(1)
    expect(argon2.verify).toHaveBeenCalledTimes(2)
    expect(argon2.verify).toHaveBeenLastCalledWith(argon2.timingHash, 'wrong')
  })

  it('surfaces a missing Argon2 implementation instead of reporting a wrong password', async () => {
    const loadArgon2 = jest.fn(async () => {
      throw new Error('Argon2id password hashing needs the "@node-rs/argon2" package')
    })
    const hasher = createPasswordHasher(config({ algorithm: 'argon2id' }), { loadArgon2 })
    await expect(hasher.hash('Secret#1')).rejects.toThrow('@node-rs/argon2')
    await expect(hasher.verify('Secret#1', '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).rejects.toThrow('@node-rs/argon2')
  })

  describe('bounded Argon2 work', () => {
    function deferredArgon2() {
      let running = 0
      let peak = 0
      const releases: Array<() => void> = []
      const gate = () => new Promise<void>((resolve) => {
        running += 1
        peak = Math.max(peak, running)
        releases.push(() => {
          running -= 1
          resolve()
        })
      })
      const argon2 = {
        hash: jest.fn(async () => {
          await gate()
          return argon2Hash()
        }),
        verify: jest.fn(async () => {
          await gate()
          return false
        }),
      }
      const releaseAll = async () => {
        for (let round = 0; round < 50; round += 1) {
          await new Promise((resolve) => setImmediate(resolve))
          releases.splice(0).forEach((release) => release())
        }
      }
      return { argon2, releaseAll, peak: () => peak, running: () => running }
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve))

    it('never runs more Argon2 operations at once than the concurrency limit during a burst', async () => {
      const fake = deferredArgon2()
      const hasher = createPasswordHasher(
        config({ algorithm: 'argon2id', argon2Limits: { maxConcurrency: 2, maxQueue: 100 } }),
        { loadArgon2: async () => fake.argon2 },
      )
      const burst = Array.from({ length: 20 }, (_unused, index) => hasher.hash(`Secret#${index}`))
      await flush()
      expect(fake.running()).toBe(2)
      await fake.releaseAll()
      await Promise.all(burst)
      expect(fake.peak()).toBe(2)
      expect(fake.argon2.hash).toHaveBeenCalledTimes(20)
    })

    it('rejects work beyond the queue bound with PasswordHasherBusyError and recovers afterwards', async () => {
      const fake = deferredArgon2()
      const hasher = createPasswordHasher(
        config({ algorithm: 'argon2id', argon2Limits: { maxConcurrency: 1, maxQueue: 2 } }),
        { loadArgon2: async () => fake.argon2 },
      )
      const accepted = [hasher.hash('a'), hasher.hash('b'), hasher.hash('c')]
      await flush()
      const rejected = hasher.hash('d')
      await expect(rejected).rejects.toBeInstanceOf(PasswordHasherBusyError)
      await expect(rejected.catch((error: unknown) => isPasswordHasherBusyError(error))).resolves.toBe(true)
      await fake.releaseAll()
      await Promise.all(accepted)
      expect(fake.peak()).toBe(1)
      const after = hasher.hash('e')
      await fake.releaseAll()
      await expect(after).resolves.toMatch(/^\$argon2id\$/)
    })

    it('rejects an overflowing login verification instead of reporting a wrong password', async () => {
      const fake = deferredArgon2()
      const hasher = createPasswordHasher(
        config({ algorithm: 'argon2id', argon2Limits: { maxConcurrency: 1, maxQueue: 1 } }),
        { loadArgon2: async () => fake.argon2 },
      )
      const stored = argon2Hash()
      const warmUp = hasher.equalizeTiming('warm-up')
      await fake.releaseAll()
      await warmUp
      const pending = [hasher.verify('wrong', stored), hasher.verify('wrong', stored)]
      await flush()
      await expect(hasher.verify('wrong', stored)).rejects.toBeInstanceOf(PasswordHasherBusyError)
      await fake.releaseAll()
      await expect(Promise.all(pending)).resolves.toEqual([false, false])
    })
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
