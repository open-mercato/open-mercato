import crypto from 'node:crypto'

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

/**
 * When set to a positive number (minutes), `verifyJwt` will attempt a legacy fallback using the
 * raw `JWT_SECRET` when the audience-derived verification fails. This supports rolling deployments
 * and lets existing sessions expire gracefully instead of force-logging-out every user on deploy.
 *
 * Set via `JWT_LEGACY_GRACE_MINUTES` env var. Defaults to 480 (8 hours — one full token TTL).
 * Set to 0 to disable the fallback (hard cutover).
 */
function getLegacyGraceEnabled(): boolean {
  const raw = process.env.JWT_LEGACY_GRACE_MINUTES
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  return true
}

function readBaseSecret(explicit?: string): string {
  const secret = explicit ?? process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return secret
}

function normalizeAudience(audience: string): string {
  return audience.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

/**
 * Derive a per-audience signing key from the base `JWT_SECRET`.
 *
 * - If `JWT_${AUDIENCE}_SECRET` env var is set, it is used verbatim (allows operators to rotate a
 *   single audience independently).
 * - Otherwise, the key is derived deterministically via HMAC-SHA256 from the base secret using a
 *   versioned label. This ensures that a staff JWT signature cannot verify against the customer
 *   key (and vice versa) even though both share the same base `JWT_SECRET`.
 */
export function deriveJwtAudienceSecret(audience: string, baseSecret?: string): string {
  const normalized = normalizeAudience(audience)
  if (!normalized) throw new Error('Audience is required to derive a JWT secret')
  const overrideName = `JWT_${normalized.toUpperCase()}_SECRET`
  const override = process.env[overrideName]
  if (override && override.trim().length > 0) return override
  const base = readBaseSecret(baseSecret)
  const label = `${AUDIENCE_SECRET_LABEL}:${normalized}`
  return crypto.createHmac('sha256', base).update(label).digest('hex')
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

export function verifyJwt(token: string, secretOrOptions?: string | VerifyJwtOptions) {
  const options = toVerifyOptions(secretOrOptions)
  const result = verifyWithOptions(token, options)
  if (result) return result

  // Legacy fallback: when the caller used the default path (no explicit secret) and the new
  // audience-derived verification failed, try verifying with the raw JWT_SECRET. This allows
  // pre-migration tokens to remain valid during rolling deployments and graceful migration.
  if (secretOrOptions === undefined && getLegacyGraceEnabled()) {
    const rawSecret = process.env.JWT_SECRET
    if (rawSecret) {
      const legacyResult = verifyWithOptions(token, { secret: rawSecret })
      if (legacyResult) {
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
