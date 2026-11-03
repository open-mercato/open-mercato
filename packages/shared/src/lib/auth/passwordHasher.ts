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
 * before and never load or run Argon2. `argon2id` is opt-in and loads
 * `@node-rs/argon2` lazily. Every Argon2 operation runs through a process-wide
 * bounded concurrency limiter (`OM_PASSWORD_ARGON2_MAX_CONCURRENCY` slots,
 * `OM_PASSWORD_ARGON2_MAX_QUEUE` waiters) so memory-hard work cannot be
 * amplified by a burst of login attempts; overflow throws
 * `PasswordHasherBusyError`, which login routes answer with 503.
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

export type Argon2WorkLimits = {
  /** Argon2 operations allowed to run at the same time in this process. */
  maxConcurrency: number
  /** Argon2 operations allowed to wait for a slot before new ones are rejected. */
  maxQueue: number
}

export type PasswordHasherConfig = {
  algorithm: PasswordHashAlgorithm
  bcryptCost: number
  argon2id: Argon2idParams
  /** Bounds for memory-hard Argon2 work. Defaults to `DEFAULT_ARGON2_WORK_LIMITS`. */
  argon2Limits?: Argon2WorkLimits
}

export interface PasswordHasher {
  /** Algorithm used for new hashes. */
  readonly algorithm: PasswordHashAlgorithm
  /** Hash a password with the configured algorithm. */
  hash(password: string): Promise<string>
  /**
   * Verify a password against a supported stored hash. Every outcome spends the same work:
   * one bcrypt comparison, plus one Argon2id verification when Argon2id is configured.
   */
  verify(password: string, storedHash: string): Promise<boolean>
  /** True when the stored hash should be replaced by a fresh hash with the current configuration. */
  needsRehash(storedHash: string): boolean
  /**
   * Spend the same work as `verify` without any account data.
   * Login flows call it on every branch that has no stored hash to compare
   * against, so response latency does not reveal whether an account exists.
   */
  equalizeTiming(password: string): Promise<void>
}

export const PASSWORD_HASH_ENV = 'OM_PASSWORD_HASH'
export const PASSWORD_ARGON2_MEMORY_KIB_ENV = 'OM_PASSWORD_ARGON2_MEMORY_KIB'
export const PASSWORD_ARGON2_TIME_COST_ENV = 'OM_PASSWORD_ARGON2_TIME_COST'
export const PASSWORD_ARGON2_PARALLELISM_ENV = 'OM_PASSWORD_ARGON2_PARALLELISM'
export const PASSWORD_ARGON2_MAX_CONCURRENCY_ENV = 'OM_PASSWORD_ARGON2_MAX_CONCURRENCY'
export const PASSWORD_ARGON2_MAX_QUEUE_ENV = 'OM_PASSWORD_ARGON2_MAX_QUEUE'

export const DEFAULT_BCRYPT_COST = 10

/** OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1. */
export const DEFAULT_ARGON2ID_PARAMS: Readonly<Argon2idParams> = Object.freeze({
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
})

export const DEFAULT_ARGON2_WORK_LIMITS: Readonly<Argon2WorkLimits> = Object.freeze({
  maxConcurrency: 4,
  maxQueue: 64,
})

const PASSWORD_HASHER_BUSY_CODE = 'password_hasher_busy'

/** Thrown when the bounded Argon2 work queue is full. Login routes answer it with 503. */
export class PasswordHasherBusyError extends Error {
  readonly code = PASSWORD_HASHER_BUSY_CODE

  constructor() {
    super('[internal] Password hashing capacity exhausted')
    this.name = 'PasswordHasherBusyError'
  }
}

export function isPasswordHasherBusyError(error: unknown): error is PasswordHasherBusyError {
  return error instanceof PasswordHasherBusyError
    || (error instanceof Error && (error as { code?: unknown }).code === PASSWORD_HASHER_BUSY_CODE)
}

// A fixed, valid bcrypt hash (cost 10) of a throwaway value no real password can
// match — the same value the staff login used before this module existed, so the
// bcrypt timing floor is unchanged (issue #2242).
const BCRYPT_TIMING_EQUALIZER_HASH = '$2b$10$OcZrhmZpIzJOjkfwUrk7d.Nl0eHNzOvalBcBlt5Ran.4lj8R3HZg6'

const BCRYPT_HASH = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/
const ARGON2_VERSION = 19
const ARGON2_SALT_MIN_BYTES = 16
const ARGON2_OUTPUT_BYTES = 32
const ARGON2_MEMORY_MAX_KIB = 4 * 1024 * 1024
const ARGON2_TIME_COST_MAX = 100
const ARGON2_PARALLELISM_MAX = 255
const ARGON2_MAX_CONCURRENCY_MAX = 256
const ARGON2_MAX_QUEUE_MAX = 100_000

const logger = createLogger('auth').child({ component: 'password-hasher' })

export function detectPasswordHashAlgorithm(storedHash: string | null | undefined): PasswordHashAlgorithm | null {
  if (typeof storedHash !== 'string') return null
  if (BCRYPT_HASH.test(storedHash)) return 'bcrypt'
  if (storedHash.startsWith('$argon2id$')) return 'argon2id'
  return null
}

function parseIntegerInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback
  const normalized = raw.trim()
  if (!/^[1-9]\d*$/.test(normalized)) return fallback
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

export function resolvePasswordHasherConfig(env: NodeJS.ProcessEnv = process.env): PasswordHasherConfig {
  const rawAlgorithm = (env[PASSWORD_HASH_ENV] ?? '').trim().toLowerCase()
  let algorithm: PasswordHashAlgorithm = 'bcrypt'
  if (rawAlgorithm === 'argon2id') {
    algorithm = 'argon2id'
  } else if (rawAlgorithm.length > 0 && rawAlgorithm !== 'bcrypt') {
    logger.warn('Unsupported OM_PASSWORD_HASH value, falling back to bcrypt', { value: rawAlgorithm })
  }
  const parallelism = parseIntegerInRange(
    env[PASSWORD_ARGON2_PARALLELISM_ENV],
    DEFAULT_ARGON2ID_PARAMS.parallelism,
    DEFAULT_ARGON2ID_PARAMS.parallelism,
    ARGON2_PARALLELISM_MAX,
  )
  const memoryCost = parseIntegerInRange(
    env[PASSWORD_ARGON2_MEMORY_KIB_ENV],
    DEFAULT_ARGON2ID_PARAMS.memoryCost,
    DEFAULT_ARGON2ID_PARAMS.memoryCost,
    ARGON2_MEMORY_MAX_KIB,
  )
  const timeCost = parseIntegerInRange(
    env[PASSWORD_ARGON2_TIME_COST_ENV],
    DEFAULT_ARGON2ID_PARAMS.timeCost,
    DEFAULT_ARGON2ID_PARAMS.timeCost,
    ARGON2_TIME_COST_MAX,
  )
  const maxConcurrency = parseIntegerInRange(
    env[PASSWORD_ARGON2_MAX_CONCURRENCY_ENV],
    DEFAULT_ARGON2_WORK_LIMITS.maxConcurrency,
    1,
    ARGON2_MAX_CONCURRENCY_MAX,
  )
  const maxQueue = parseIntegerInRange(
    env[PASSWORD_ARGON2_MAX_QUEUE_ENV],
    DEFAULT_ARGON2_WORK_LIMITS.maxQueue,
    1,
    ARGON2_MAX_QUEUE_MAX,
  )
  return {
    algorithm,
    bcryptCost: DEFAULT_BCRYPT_COST,
    argon2id: { memoryCost, timeCost, parallelism },
    argon2Limits: { maxConcurrency, maxQueue },
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
          throw new Error('[internal] @node-rs/argon2 does not expose hash/verify')
        }
        return candidate as Argon2Module
      })
      .catch((error: unknown) => {
        argon2ModulePromise = null
        throw new Error(
          '[internal] Argon2id password hashing needs the "@node-rs/argon2" package, which could not be loaded on this platform',
          { cause: error },
        )
      })
  }
  return argon2ModulePromise
}

type ParsedArgon2idHash = Argon2idParams & {
  version: number
  saltLength: number
  outputLength: number
}

function parsePhcBase64Length(value: string): number | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value) || value.length % 4 === 1) return null
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64').replace(/=+$/u, '') !== value) return null
  return decoded.length
}

function parseArgon2idHash(storedHash: string): ParsedArgon2idHash | null {
  const segments = storedHash.split('$')
  if (
    segments.length !== 6
    || segments[0] !== ''
    || segments[1] !== 'argon2id'
    || !segments[2].startsWith('v=')
  ) return null

  const version = parseIntegerInRange(segments[2].slice(2), -1, 1, Number.MAX_SAFE_INTEGER)
  const rawParams = segments[3].split(',')
  if (rawParams.length !== 3) return null
  const params = new Map<string, string>()
  for (const rawParam of rawParams) {
    const separator = rawParam.indexOf('=')
    if (separator <= 0 || separator === rawParam.length - 1) return null
    const key = rawParam.slice(0, separator)
    if (params.has(key)) return null
    params.set(key, rawParam.slice(separator + 1))
  }
  if (params.size !== 3 || !params.has('m') || !params.has('t') || !params.has('p')) return null

  const memoryCost = parseIntegerInRange(params.get('m'), -1, 1, Number.MAX_SAFE_INTEGER)
  const timeCost = parseIntegerInRange(params.get('t'), -1, 1, Number.MAX_SAFE_INTEGER)
  const parallelism = parseIntegerInRange(params.get('p'), -1, 1, Number.MAX_SAFE_INTEGER)
  const saltLength = parsePhcBase64Length(segments[4])
  const outputLength = parsePhcBase64Length(segments[5])
  if (
    version < 0
    || memoryCost < 0
    || timeCost < 0
    || parallelism < 0
    || saltLength === null
    || outputLength === null
  ) return null

  return {
    version,
    memoryCost,
    timeCost,
    parallelism,
    saltLength,
    outputLength,
  }
}

type Argon2WorkLimiter = <T>(task: () => Promise<T>) => Promise<T>

function createArgon2WorkLimiter(limits: Argon2WorkLimits): Argon2WorkLimiter {
  let active = 0
  const waiting: Array<() => void> = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limits.maxConcurrency) {
      if (waiting.length >= limits.maxQueue) throw new PasswordHasherBusyError()
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      active += 1
    }
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}

export function createPasswordHasher(
  config: PasswordHasherConfig = resolvePasswordHasherConfig(),
  deps: PasswordHasherDeps = {},
): PasswordHasher {
  const loadArgon2 = deps.loadArgon2 ?? loadDefaultArgon2
  const argon2Params: Argon2idParams = { ...config.argon2id }
  const withArgon2Slot = createArgon2WorkLimiter(config.argon2Limits ?? DEFAULT_ARGON2_WORK_LIMITS)
  const argon2InProfile = config.algorithm === 'argon2id'
  let loadedArgon2: Promise<Argon2Module> | null = null
  let argon2TimingHash: Promise<string> | null = null

  const getArgon2 = (): Promise<Argon2Module> => {
    if (!loadedArgon2) {
      loadedArgon2 = loadArgon2().catch((error: unknown) => {
        loadedArgon2 = null
        throw error
      })
    }
    return loadedArgon2
  }

  const getArgon2TimingHash = (): Promise<string> => {
    if (!argon2TimingHash) {
      argon2TimingHash = getArgon2()
        .then((argon2) => withArgon2Slot(() => argon2.hash(randomBytes(32).toString('hex'), argon2Params)))
        .catch((error: unknown) => {
          argon2TimingHash = null
          throw error
        })
    }
    return argon2TimingHash
  }

  const verifyArgon2TimingHash = async (password: string): Promise<void> => {
    const argon2 = await getArgon2()
    const timingHash = await getArgon2TimingHash()
    await withArgon2Slot(() => argon2.verify(timingHash, password))
  }

  const hash = async (password: string): Promise<string> => {
    if (config.algorithm === 'argon2id') {
      const argon2 = await getArgon2()
      return withArgon2Slot(() => argon2.hash(password, argon2Params))
    }
    return bcryptHash(password, config.bcryptCost)
  }

  const verifyStoredArgon2id = async (password: string, storedHash: string): Promise<boolean> => {
    // A missing Argon2 implementation is an operator error and must surface,
    // not masquerade as a wrong password.
    const argon2 = await getArgon2()
    // On a cold process the profile's dummy path creates its Argon2id timing hash
    // before verifying it; create the same cached hash here so both paths match.
    if (argon2InProfile) await getArgon2TimingHash()
    try {
      return await withArgon2Slot(() => argon2.verify(storedHash, password))
    } catch (error) {
      if (error instanceof PasswordHasherBusyError) throw error
      // A stored hash the library rejects (e.g. parameters below its minimum) fails fast;
      // spend the dummy verification so it still matches the profile.
      if (argon2InProfile) await verifyArgon2TimingHash(password)
      return false
    }
  }

  // Every outcome of `verify` (match, mismatch, malformed or unknown hash) spends the same
  // work profile: one bcrypt comparison, plus one Argon2id verification when Argon2id is
  // the configured algorithm. A correct password therefore costs as much as a wrong one, so
  // callers that reject an account after a successful check (deactivated, unverified, locked)
  // do not expose password validity through latency.
  const verify = async (password: string, storedHash: string): Promise<boolean> => {
    const algorithm = detectPasswordHashAlgorithm(storedHash)
    if (algorithm === 'argon2id') {
      const parsed = parseArgon2idHash(storedHash)
      let matched = false
      if (parsed) matched = await verifyStoredArgon2id(password, storedHash)
      else if (argon2InProfile) await verifyArgon2TimingHash(password)
      await bcryptCompare(password, BCRYPT_TIMING_EQUALIZER_HASH)
      return matched
    }
    const matched = await bcryptCompare(password, algorithm === 'bcrypt' ? storedHash : BCRYPT_TIMING_EQUALIZER_HASH)
    if (argon2InProfile) await verifyArgon2TimingHash(password)
    return algorithm === 'bcrypt' && matched
  }

  const needsRehash = (storedHash: string): boolean => {
    const algorithm = detectPasswordHashAlgorithm(storedHash)
    if (algorithm === null) return false
    if (algorithm !== config.algorithm) return true
    if (algorithm === 'argon2id') {
      const params = parseArgon2idHash(storedHash)
      if (!params) return true
      return (
        params.version !== ARGON2_VERSION
        || params.memoryCost !== argon2Params.memoryCost
        || params.timeCost !== argon2Params.timeCost
        || params.parallelism !== argon2Params.parallelism
        || params.saltLength < ARGON2_SALT_MIN_BYTES
        || params.outputLength !== ARGON2_OUTPUT_BYTES
      )
    }
    // bcrypt → bcrypt: never rehash, so the default configuration writes nothing.
    return false
  }

  const equalizeTiming = async (password: string): Promise<void> => {
    await bcryptCompare(password, BCRYPT_TIMING_EQUALIZER_HASH)
    if (argon2InProfile) await verifyArgon2TimingHash(password)
  }

  return {
    algorithm: config.algorithm,
    hash,
    verify,
    needsRehash,
    equalizeTiming,
  }
}

// Kept on globalThis so every copy of this module (separate server bundles,
// CLI vs worker entry points) shares one hasher and one `setPasswordHasher` override.
const GLOBAL_KEY = Symbol.for('@open-mercato/shared.passwordHasher')

type PasswordHasherStore = { active?: PasswordHasher | null }

function store(): PasswordHasherStore {
  const globalStore = globalThis as unknown as Record<symbol, PasswordHasherStore | undefined>
  let current = globalStore[GLOBAL_KEY]
  if (!current) {
    current = {}
    globalStore[GLOBAL_KEY] = current
  }
  return current
}

/**
 * The process-wide password hasher, built from the environment on first use.
 * Also registered in DI as `passwordHasher` by the `auth` module.
 */
export function getPasswordHasher(): PasswordHasher {
  const current = store()
  if (!current.active) current.active = createPasswordHasher()
  return current.active
}

/**
 * Replace the process-wide password hasher (for example from an app's `di.ts`
 * with a custom implementation). Pass `null` to rebuild it from the environment
 * on next use.
 */
export function setPasswordHasher(hasher: PasswordHasher | null): void {
  store().active = hasher
}
