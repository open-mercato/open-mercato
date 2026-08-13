import crypto from 'node:crypto'
import { createLogger } from '../logger'
import { parseNumberWithDefault } from '../number'

const logger = createLogger('auth').child({ component: 'jwt' })

function base64url(input: Buffer | string) {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export type JwtPayload = Record<string, any>

export type JwtAudience = 'staff' | 'customer' | (string & {})

export type SignJwtOptions = {
  secret?: string
  expiresInSec?: number
  audience?: string
  issuer?: string
}

export type VerifyJwtOptions = {
  secret?: string
  audience?: string
  issuer?: string
}

const DEFAULT_ISSUER = 'open-mercato'
const DEFAULT_STAFF_AUDIENCE: JwtAudience = 'staff'
const AUDIENCE_SECRET_LABEL = 'open-mercato:jwt:v1'

const LEGACY_GRACE_DEFAULT_MINUTES = 480
const LEGACY_TOKEN_CLOCK_SKEW_SECONDS = 60

/**
 * How long after a token was issued (`iat`) the raw-`JWT_SECRET` fallback in `verifyJwt` keeps
 * accepting it. The fallback exists so a rolling deployment of the audience-derived signing
 * scheme does not force-log-out every user; it is a migration window, not a permanent mode.
 *
 * Set via `JWT_LEGACY_GRACE_MINUTES`. Defaults to 480 (8 hours — one full token TTL).
 * `0`, `false` or `off` disables the fallback entirely (hard cutover). Values that do not parse
 * fall back to the default rather than silently disabling authentication.
 */
function getLegacyGraceMinutes(): number {
  const raw = process.env.JWT_LEGACY_GRACE_MINUTES
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : raw
  if (normalized === 'false' || normalized === 'off') return 0
  return parseNumberWithDefault(normalized, LEGACY_GRACE_DEFAULT_MINUTES, { min: 0, integer: true })
}

/**
 * Required absolute deadline for the legacy fallback, as an ISO-8601 instant in
 * `JWT_LEGACY_CUTOVER_AT`. Without a valid deadline the fallback stays disabled: token `iat` is
 * attacker-controlled by anyone who knows the former raw secret, so a relative age check alone
 * cannot make the migration window finite.
 */
function getLegacyCutoverEpochSeconds(): number | null {
  const raw = process.env.JWT_LEGACY_CUTOVER_AT
  if (!raw || !raw.trim()) return null
  const parsed = Date.parse(raw.trim())
  if (Number.isNaN(parsed)) {
    warnOnce(
      'jwt-legacy-cutover-unparseable',
      'JWT_LEGACY_CUTOVER_AT is not a valid ISO-8601 instant — legacy JWT fallback remains disabled.',
    )
    return null
  }
  return Math.floor(parsed / 1000)
}

const MIN_SECRET_LENGTH = 32

/**
 * Signing secrets that ship in this repository's own examples, compose files, and docs. A
 * deployment reaching production with one of these is not "weakly configured" — it is publicly
 * forgeable by anyone who has read the repository.
 */
const PLACEHOLDER_SECRETS = new Set([
  'jwt',
  'jwt-secret',
  'jwtsecret',
  'secret',
  'password',
  'changeme',
  'change-me',
  'change-me-dev-secret',
  'change-me-dev-auth-secret',
  'your-strong-jwt-secret',
  'your-secure-jwt-secret-change-me',
  'dev',
  'development',
  'test',
])

export type JwtSecretViolation = 'missing' | 'placeholder' | 'too_short'

const warnedKeys = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  logger.warn(message)
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function inspectSecret(secret: string | undefined | null): JwtSecretViolation | null {
  const value = typeof secret === 'string' ? secret.trim() : ''
  if (!value) return 'missing'
  if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) return 'placeholder'
  if (value.length < MIN_SECRET_LENGTH) return 'too_short'
  return null
}

function describeViolation(name: string, violation: JwtSecretViolation): string {
  switch (violation) {
    case 'missing':
      return `${name} is not set. Generate one with \`openssl rand -hex 32\`.`
    case 'placeholder':
      return `${name} is set to a placeholder value published in this repository's examples, so anyone can forge tokens for this deployment. Generate a real one with \`openssl rand -hex 32\`.`
    case 'too_short':
      return `${name} is shorter than ${MIN_SECRET_LENGTH} characters. Generate a stronger one with \`openssl rand -hex 32\`.`
  }
}

/**
 * Fail closed in production, warn in every other environment. Called on every secret read so
 * worker, scheduler, and CLI processes — which never run the app's startup hook — are covered
 * too. `assertJwtSecretPolicy` runs the same check eagerly at server startup.
 */
function enforceSecretPolicy(name: string, secret: string | undefined | null): void {
  const violation = inspectSecret(secret)
  if (!violation) return
  const message = describeViolation(name, violation)
  if (isProduction()) {
    throw new Error(`[auth.jwt] Refusing to run in production with an unsafe signing secret: ${message}`)
  }
  warnOnce(`secret-policy:${name}:${violation}`, `${message} This is tolerated outside production only.`)
}

/**
 * Validate every JWT signing secret this process would use. Call it once at startup so a
 * misconfigured production deployment fails immediately and loudly instead of at the first login
 * attempt. Throws in production; logs a warning elsewhere.
 */
export function assertJwtSecretPolicy(): void {
  enforceSecretPolicy('JWT_SECRET', process.env.JWT_SECRET)
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^JWT_[A-Z0-9]+(?:_[A-Z0-9]+)*_SECRET$/.test(key)) continue
    enforceSecretPolicy(key, value)
  }
}

function readBaseSecret(explicit?: string): string {
  const secret = explicit ?? process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  if (explicit === undefined) enforceSecretPolicy('JWT_SECRET', secret)
  return secret
}

function normalizeAudience(audience: string): string {
  return audience.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

const derivedSecretCache = new Map<string, string>()

function deriveAudienceSecretFromBase(normalized: string, base: string): string {
  const cacheKey = `${normalized}::${base}`
  const cached = derivedSecretCache.get(cacheKey)
  if (cached !== undefined) return cached
  const label = `${AUDIENCE_SECRET_LABEL}:${normalized}`
  const derived = crypto.createHmac('sha256', base).update(label).digest('hex')
  derivedSecretCache.set(cacheKey, derived)
  return derived
}

/**
 * Derive a per-audience signing key from the base `JWT_SECRET`.
 *
 * - If `JWT_${AUDIENCE}_SECRET` env var is set, it is used verbatim (allows operators to rotate a
 *   single audience independently).
 * - Otherwise, the key is derived deterministically via HMAC-SHA256 from the base secret using a
 *   versioned label. This ensures that a staff JWT signature cannot verify against the customer
 *   key (and vice versa) even though both share the same base `JWT_SECRET`.
 * - Derived values are memoized per `(audience, baseSecret)` for the process lifetime.
 */
export function deriveJwtAudienceSecret(audience: string, baseSecret?: string): string {
  const normalized = normalizeAudience(audience)
  if (!normalized) throw new Error('Audience is required to derive a JWT secret')
  const overrideName = `JWT_${normalized.toUpperCase()}_SECRET`
  const override = process.env[overrideName]
  if (override && override.trim().length > 0) {
    enforceSecretPolicy(overrideName, override)
    return override
  }
  const base = readBaseSecret(baseSecret)
  return deriveAudienceSecretFromBase(normalized, base)
}

function isSignOptions(value: string | SignJwtOptions | undefined): value is SignJwtOptions {
  return typeof value === 'object' && value !== null
}

function isVerifyOptions(value: string | VerifyJwtOptions | undefined): value is VerifyJwtOptions {
  return typeof value === 'object' && value !== null
}

function toSignOptions(secretOrOptions?: string | SignJwtOptions, expiresInSec?: number): { secret: string; expiresInSec: number; audience?: string; issuer?: string } {
  if (isSignOptions(secretOrOptions)) {
    const audience = secretOrOptions.audience ?? DEFAULT_STAFF_AUDIENCE
    const secret = secretOrOptions.secret ?? deriveJwtAudienceSecret(audience)
    if (!secret) throw new Error('JWT_SECRET is not set')
    return {
      secret,
      expiresInSec: secretOrOptions.expiresInSec ?? 60 * 60 * 8,
      audience,
      issuer: secretOrOptions.issuer ?? DEFAULT_ISSUER,
    }
  }
  if (typeof secretOrOptions === 'string') {
    // Legacy: explicit raw secret supplied by caller — keep audience/issuer off by default so
    // existing tests and callers that BYO secret see unchanged behavior.
    if (!secretOrOptions) throw new Error('JWT_SECRET is not set')
    return {
      secret: secretOrOptions,
      expiresInSec: expiresInSec ?? 60 * 60 * 8,
    }
  }
  // Default path: staff-audience derived secret + iss/aud claims.
  return {
    secret: deriveJwtAudienceSecret(DEFAULT_STAFF_AUDIENCE),
    expiresInSec: expiresInSec ?? 60 * 60 * 8,
    audience: DEFAULT_STAFF_AUDIENCE,
    issuer: DEFAULT_ISSUER,
  }
}

function toVerifyOptions(secretOrOptions?: string | VerifyJwtOptions): { secret: string; audience?: string; issuer?: string } {
  if (isVerifyOptions(secretOrOptions)) {
    const audience = secretOrOptions.audience ?? DEFAULT_STAFF_AUDIENCE
    const secret = secretOrOptions.secret ?? deriveJwtAudienceSecret(audience)
    if (!secret) throw new Error('JWT_SECRET is not set')
    return {
      secret,
      audience,
      issuer: secretOrOptions.issuer ?? DEFAULT_ISSUER,
    }
  }
  if (typeof secretOrOptions === 'string') {
    if (!secretOrOptions) throw new Error('JWT_SECRET is not set')
    // Legacy explicit secret: no audience/issuer enforcement.
    return { secret: secretOrOptions }
  }
  return {
    secret: deriveJwtAudienceSecret(DEFAULT_STAFF_AUDIENCE),
    audience: DEFAULT_STAFF_AUDIENCE,
    issuer: DEFAULT_ISSUER,
  }
}

export function signJwt(
  payload: JwtPayload,
  secretOrOptions?: string | SignJwtOptions,
  expiresInSec?: number,
) {
  const options = toSignOptions(secretOrOptions, expiresInSec)
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body: JwtPayload = { iat: now, exp: now + options.expiresInSec, ...payload }
  if (options.issuer && body.iss === undefined) body.iss = options.issuer
  if (options.audience && body.aud === undefined) body.aud = options.audience
  const encHeader = base64url(JSON.stringify(header))
  const encBody = base64url(JSON.stringify(body))
  const data = `${encHeader}.${encBody}`
  const sig = crypto.createHmac('sha256', options.secret).update(data).digest()
  const encSig = base64url(sig)
  return `${data}.${encSig}`
}

function verifyWithOptions(token: string, options: { secret: string; audience?: string; issuer?: string }): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  const data = `${h}.${p}`
  const expected = base64url(crypto.createHmac('sha256', options.secret).update(data).digest())
  const providedSignature = Buffer.from(s)
  const expectedSignature = Buffer.from(expected)
  if (providedSignature.length !== expectedSignature.length) return null
  if (!crypto.timingSafeEqual(providedSignature, expectedSignature)) return null
  let payload: JwtPayload
  try {
    payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'))
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now > payload.exp) return null
  if (options.audience !== undefined) {
    if (payload.aud !== options.audience) return null
  }
  if (options.issuer !== undefined) {
    if (payload.iss !== options.issuer) return null
  }
  return payload
}

/**
 * Whether a raw-secret token is still inside the migration window. A token is only ever legacy
 * for a bounded period after it was issued, so `iat` is mandatory: a token that cannot prove its
 * age cannot prove it is inside the window either, and accepting it would make the window
 * unbounded — which is exactly the defect this guard closes.
 */
function isWithinLegacyWindow(payload: JwtPayload, graceMinutes: number): boolean {
  const cutoverAt = getLegacyCutoverEpochSeconds()
  const now = Math.floor(Date.now() / 1000)
  if (cutoverAt === null || now >= cutoverAt) return false
  const issuedAt = payload.iat
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return false
  if (issuedAt > now + LEGACY_TOKEN_CLOCK_SKEW_SECONDS) return false
  return now - issuedAt <= graceMinutes * 60
}

export function verifyJwt(token: string, secretOrOptions?: string | VerifyJwtOptions) {
  const options = toVerifyOptions(secretOrOptions)
  const result = verifyWithOptions(token, options)
  if (result) {
    // `_legacyToken` is assigned by this function alone. Strip any same-named claim carried in
    // the token body so a payload can never talk callers (staff session integrity, portal auth)
    // into treating a modern, session-bound token as a sessionless legacy one.
    if (result._legacyToken !== undefined) delete result._legacyToken
    return result
  }

  // Legacy fallback: when the caller used the default path (no explicit secret) and the new
  // audience-derived verification failed, try verifying with the raw JWT_SECRET. This keeps
  // pre-migration tokens working across a rolling deployment — but only until the token's own
  // `iat` leaves the configured grace window, or the configured cutover instant passes.
  if (secretOrOptions === undefined) {
    const graceMinutes = getLegacyGraceMinutes()
    const rawSecret = process.env.JWT_SECRET
    if (graceMinutes > 0 && rawSecret) {
      const legacyResult = verifyWithOptions(token, { secret: rawSecret })
      if (legacyResult && isWithinLegacyWindow(legacyResult, graceMinutes)) {
        legacyResult._legacyToken = true
        return legacyResult
      }
    }
  }

  return null
}

/**
 * Sign a JWT for a specific audience using an audience-derived signing key. The resulting token
 * carries `iss` and `aud` claims and cannot be verified with the base `JWT_SECRET` directly —
 * callers must use `verifyAudienceJwt` with the same audience.
 */
export function signAudienceJwt(
  audience: string,
  payload: JwtPayload,
  expiresInSec: number = 60 * 60 * 8,
): string {
  return signJwt(payload, { audience, expiresInSec })
}

/**
 * Verify a JWT that was signed with an audience-scoped secret. Rejects tokens that are missing
 * or carry a mismatched `aud`/`iss` claim, so a staff JWT cannot be replayed against the
 * customer portal (and vice versa) even when the base `JWT_SECRET` is shared.
 */
export function verifyAudienceJwt(audience: string, token: string): JwtPayload | null {
  return verifyJwt(token, { audience })
}
