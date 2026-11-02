import { randomBytes } from 'node:crypto'
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs'
import { createLogger } from '../logger'

/**
 * Pluggable password hashing for user and customer-portal passwords.
 *
 * The stored hash carries its own algorithm (PHC/modular-crypt prefix), so
 * `verify` works for every supported format regardless of the configured
 * algorithm. The configured algorithm (`OM_PASSWORD_HASH`) only decides how NEW
 * passwords are hashed and which stored hashes `needsRehash` flags for an
 * opportunistic upgrade after a successful login.
 *
 * The default stays `bcrypt` (cost 10) so existing installs behave exactly as
 * before. `argon2id` is opt-in and loads `@node-rs/argon2` lazily, only when a
 * process actually hashes or verifies an Argon2id password.
 */

export type PasswordHashAlgorithm = 'bcrypt' | 'argon2id'

export type Argon2idParams = {
  /** Memory cost in KiB. */
  memoryCost: number
  /** Number of iterations. */
  timeCost: number
  /** Degree of parallelism (lanes). */
  parallelism: number
}

export type PasswordHasherConfig = {
  algorithm: PasswordHashAlgorithm
  bcryptCost: number
  argon2id: Argon2idParams
}

export interface PasswordHasher {
  /** Algorithm used for new hashes. */
  readonly algorithm: PasswordHashAlgorithm
  /** Hash a password with the configured algorithm. */
  hash(password: string): Promise<string>
  /** Verify a password against a stored bcrypt or Argon2id hash. Unknown formats never match. */
  verify(password: string, storedHash: string): Promise<boolean>
  /** True when the stored hash should be replaced by a fresh hash with the current configuration. */
  needsRehash(storedHash: string): boolean
  /**
   * Spend the same CPU time as a real verification without any account data.
   * Login flows call it on every branch that has no stored hash to compare
   * against, so response latency does not reveal whether an account exists.
   */
  equalizeTiming(password: string): Promise<void>
}

export const PASSWORD_HASH_ENV = 'OM_PASSWORD_HASH'
export const PASSWORD_ARGON2_MEMORY_KIB_ENV = 'OM_PASSWORD_ARGON2_MEMORY_KIB'
export const PASSWORD_ARGON2_TIME_COST_ENV = 'OM_PASSWORD_ARGON2_TIME_COST'
export const PASSWORD_ARGON2_PARALLELISM_ENV = 'OM_PASSWORD_ARGON2_PARALLELISM'

export const DEFAULT_BCRYPT_COST = 10

/** OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1. */
export const DEFAULT_ARGON2ID_PARAMS: Readonly<Argon2idParams> = Object.freeze({
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
})

// A fixed, valid bcrypt hash (cost 10) of a throwaway value no real password can
// match — the same value the staff login used before this module existed, so the
// bcrypt timing floor is unchanged (issue #2242).
const BCRYPT_TIMING_EQUALIZER_HASH = '$2b$10$OcZrhmZpIzJOjkfwUrk7d.Nl0eHNzOvalBcBlt5Ran.4lj8R3HZg6'

const BCRYPT_PREFIX = /^\$2[aby]\$(\d{2})\$/
const ARGON2ID_PHC = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$[^$]+\$[^$]+$/
const ARGON2_VERSION = 19

const logger = createLogger('auth').child({ component: 'password-hasher' })

export function detectPasswordHashAlgorithm(storedHash: string | null | undefined): PasswordHashAlgorithm | null {
  if (typeof storedHash !== 'string') return null
  if (BCRYPT_PREFIX.test(storedHash)) return 'bcrypt'
  if (storedHash.startsWith('$argon2id$')) return 'argon2id'
  return null
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function resolvePasswordHasherConfig(env: NodeJS.ProcessEnv = process.env): PasswordHasherConfig {
  const rawAlgorithm = (env[PASSWORD_HASH_ENV] ?? '').trim().toLowerCase()
  let algorithm: PasswordHashAlgorithm = 'bcrypt'
  if (rawAlgorithm === 'argon2id') {
    algorithm = 'argon2id'
  } else if (rawAlgorithm.length > 0 && rawAlgorithm !== 'bcrypt') {
    logger.warn('Unsupported OM_PASSWORD_HASH value, falling back to bcrypt', { value: rawAlgorithm })
  }
  const parallelism = parsePositiveInt(env[PASSWORD_ARGON2_PARALLELISM_ENV], DEFAULT_ARGON2ID_PARAMS.parallelism, 1, 255)
  // Argon2 requires at least 8 KiB of memory per lane.
  const memoryCost = parsePositiveInt(
    env[PASSWORD_ARGON2_MEMORY_KIB_ENV],
    DEFAULT_ARGON2ID_PARAMS.memoryCost,
    8 * parallelism,
    4 * 1024 * 1024,
  )
  const timeCost = parsePositiveInt(env[PASSWORD_ARGON2_TIME_COST_ENV], DEFAULT_ARGON2ID_PARAMS.timeCost, 1, 100)
  return {
    algorithm,
    bcryptCost: DEFAULT_BCRYPT_COST,
    argon2id: { memoryCost, timeCost, parallelism },
  }
}

export type Argon2Module = {
  hash(password: string, options: Argon2idParams): Promise<string>
  verify(hashed: string, password: string): Promise<boolean>
}

export type PasswordHasherDeps = {
  /** Loads the Argon2 implementation. Defaults to a lazy `import('@node-rs/argon2')`. */
  loadArgon2?: () => Promise<Argon2Module>
}

let argon2ModulePromise: Promise<Argon2Module> | null = null

function loadDefaultArgon2(): Promise<Argon2Module> {
  if (!argon2ModulePromise) {
    argon2ModulePromise = import('@node-rs/argon2')
      .then((mod) => {
        const candidate = ((mod as { default?: unknown }).default ?? mod) as Partial<Argon2Module>
        if (typeof candidate.hash !== 'function' || typeof candidate.verify !== 'function') {
          throw new Error('@node-rs/argon2 does not expose hash/verify')
        }
        return candidate as Argon2Module
      })
      .catch((error: unknown) => {
        argon2ModulePromise = null
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Argon2id password hashing needs the "@node-rs/argon2" package, which could not be loaded on this platform: ${reason}`,
        )
      })
  }
  return argon2ModulePromise
}

function parseArgon2idParams(storedHash: string): (Argon2idParams & { version: number }) | null {
  const match = ARGON2ID_PHC.exec(storedHash)
  if (!match) return null
  return {
    version: Number(match[1]),
    memoryCost: Number(match[2]),
    timeCost: Number(match[3]),
    parallelism: Number(match[4]),
  }
}

export function createPasswordHasher(
  config: PasswordHasherConfig = resolvePasswordHasherConfig(),
  deps: PasswordHasherDeps = {},
): PasswordHasher {
  const loadArgon2 = deps.loadArgon2 ?? loadDefaultArgon2
  const argon2Params: Argon2idParams = { ...config.argon2id }
  let argon2TimingHash: Promise<string> | null = null

  const hash = async (password: string): Promise<string> => {
    if (config.algorithm === 'argon2id') {
      const argon2 = await loadArgon2()
      return argon2.hash(password, argon2Params)
    }
    return bcryptHash(password, config.bcryptCost)
  }

  const verify = async (password: string, storedHash: string): Promise<boolean> => {
    const algorithm = detectPasswordHashAlgorithm(storedHash)
    if (algorithm === 'bcrypt') return bcryptCompare(password, storedHash)
    if (algorithm === 'argon2id') {
      // A missing Argon2 implementation is an operator error and must surface,
      // not masquerade as a wrong password.
      const argon2 = await loadArgon2()
      try {
        return await argon2.verify(storedHash, password)
      } catch {
        return false
      }
    }
    return false
  }

  const needsRehash = (storedHash: string): boolean => {
    const algorithm = detectPasswordHashAlgorithm(storedHash)
    if (algorithm === null) return false
    if (algorithm !== config.algorithm) return true
    if (algorithm === 'argon2id') {
      const params = parseArgon2idParams(storedHash)
      if (!params) return false
      return (
        params.version !== ARGON2_VERSION
        || params.memoryCost !== argon2Params.memoryCost
        || params.timeCost !== argon2Params.timeCost
        || params.parallelism !== argon2Params.parallelism
      )
    }
    // bcrypt → bcrypt: never rehash, so the default configuration writes nothing.
    return false
  }

  const equalizeTiming = async (password: string): Promise<void> => {
    if (config.algorithm === 'argon2id') {
      if (!argon2TimingHash) {
        // Hash a random throwaway value once with the configured parameters, so
        // the dummy verification costs the same as verifying a real new hash.
        argon2TimingHash = hash(randomBytes(32).toString('hex')).catch((error: unknown) => {
          argon2TimingHash = null
          throw error
        })
      }
      await verify(password, await argon2TimingHash)
      return
    }
    await bcryptCompare(password, BCRYPT_TIMING_EQUALIZER_HASH)
  }

  return {
    algorithm: config.algorithm,
    hash,
    verify,
    needsRehash,
    equalizeTiming,
  }
}

let activePasswordHasher: PasswordHasher | null = null

/**
 * The process-wide password hasher, built from the environment on first use.
 * Also registered in DI as `passwordHasher` by the `auth` module.
 */
export function getPasswordHasher(): PasswordHasher {
  if (!activePasswordHasher) activePasswordHasher = createPasswordHasher()
  return activePasswordHasher
}

/**
 * Replace the process-wide password hasher (for example from an app's `di.ts`
 * with a custom implementation). Pass `null` to rebuild it from the environment
 * on next use.
 */
export function setPasswordHasher(hasher: PasswordHasher | null): void {
  activePasswordHasher = hasher
}
