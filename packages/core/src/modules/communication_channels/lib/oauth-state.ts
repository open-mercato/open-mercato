import crypto from 'node:crypto'

/**
 * OAuth state-cookie helper for the communication_channels hub.
 *
 * **Ported (re-implemented locally), NOT imported, from `packages/enterprise/src/modules/sso/lib/state-cookie.ts`.**
 * Root `AGENTS.md` rule: `@open-mercato/core` MUST NOT import from `@open-mercato/enterprise`.
 *
 * Design (per email integration spec § OSS Independence + § Hub Deltas → Delta 7):
 *   - AES-256-GCM payload encryption.
 *   - HKDF (SHA-256) key derivation from `OM_HUB_OAUTH_STATE_KEY` (falling back to
 *     `KMS_MASTER_KEY`). In production those dedicated keys are required; only in
 *     dev/test do we fall back to `JWT_SECRET` so envs that configure one secret
 *     still work. Production refuses the `JWT_SECRET` fallback so a session-secret
 *     leak cannot also forge OAuth-state cookies.
 *   - 5-minute TTL — short window to bound replay surface.
 *   - Payload binds the initiating `userId` so the callback rejects state cookies
 *     used by a different session.
 *
 * The output is a base64url string that we set on an HttpOnly + SameSite=Lax cookie.
 * Forgery requires the encryption key (KMS-managed in production).
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
export const COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS = 5 * 60 * 1000
const HKDF_SALT = Buffer.from('open-mercato-channels-oauth-state-v1')
const HKDF_INFO = Buffer.from('communication_channels-oauth-state-cookie')

export const COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME =
  'om_cc_oauth_state'

export const DEFAULT_OAUTH_RETURN_URL = '/backend/profile/communication-channels'

/** Errors thrown by the helpers. Stable for tests + route mapping. */
export class OAuthStateError extends Error {
  override name = 'OAuthStateError'
  constructor(
    message: string,
    readonly code:
      | 'missing_secret'
      | 'invalid_cookie'
      | 'expired'
      | 'user_mismatch'
      | 'decrypt_failed',
  ) {
    super(message)
  }
}

/**
 * Canonical state-cookie payload — provider-agnostic. Each OAuth provider
 * adapter (Gmail, …) packs its own per-flow nonce / verifier into
 * the `extra` field rather than extending this shape.
 */
export interface OAuthStatePayload {
  /** Nonce-like opaque value mirrored into the OAuth `state` query parameter. */
  state: string
  /** Per-flow CSRF nonce, returned alongside the OAuth response. */
  nonce: string
  /** Tenant-scoped user that initiated the flow. Validated on callback. */
  userId: string
  /** Tenant scope so the callback can pin the channel to the same tenant. */
  tenantId: string
  /** Optional organization id for multi-org tenants. */
  organizationId?: string | null
  /** Provider key (e.g. `gmail`) — routes the callback. */
  providerKey: string
  /** Where to redirect on success. Defaults to the profile page in the route. */
  returnUrl?: string
  /** Wall-clock expiry (ms since epoch). */
  expiresAt: number
  /** Provider-specific extras (PKCE code_verifier, scopes, login_hint, …). */
  extra?: Record<string, unknown>
}

export function isSafeOAuthReturnUrl(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 2048) return false
  if (!value.startsWith('/') || value.startsWith('//')) return false
  if (value.includes('\\')) return false
  try {
    const base = new URL('https://open-mercato.local')
    const parsed = new URL(value, base)
    return parsed.origin === base.origin && parsed.pathname.startsWith('/')
  } catch {
    return false
  }
}

export function normalizeOAuthReturnUrl(
  value: string | null | undefined,
  fallback: string = DEFAULT_OAUTH_RETURN_URL,
): string {
  return isSafeOAuthReturnUrl(value) ? value : fallback
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32))
}

function getSecret(): string {
  const dedicated = process.env.OM_HUB_OAUTH_STATE_KEY ?? process.env.KMS_MASTER_KEY
  if (dedicated) return dedicated
  // No dedicated key configured. Fail closed in production rather than deriving
  // the state-cookie key from JWT_SECRET (the platform session-signing secret) —
  // sharing that key means a JWT_SECRET leak also lets an attacker forge OAuth
  // state cookies, bypassing the userId/tenant binding. In non-production we fall
  // back to JWT_SECRET so dev/test envs that only configure one secret still work.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[internal] OM_HUB_OAUTH_STATE_KEY or KMS_MASTER_KEY required in production')
  }
  const fallback = process.env.JWT_SECRET
  if (!fallback) {
    throw new OAuthStateError(
      'OM_HUB_OAUTH_STATE_KEY (or fallback KMS_MASTER_KEY / JWT_SECRET) must be set',
      'missing_secret',
    )
  }
  return fallback
}

/** Encrypt + sign a state payload. Output is a base64url string suitable for a cookie. */
export function encryptOAuthState(payload: OAuthStatePayload): string {
  const key = deriveKey(getSecret())
  const iv = crypto.randomBytes(IV_LENGTH)
  const json = JSON.stringify(payload)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

/**
 * Decrypt + verify a state cookie. Returns the payload or `null` if the cookie
 * is malformed / tampered. Returns the payload (NOT null) when the cookie has
 * expired — callers should check `expiresAt` themselves with the verification
 * helper below for stable status codes.
 */
export function decryptOAuthState(cookie: string): OAuthStatePayload | null {
  try {
    const key = deriveKey(getSecret())
    const combined = Buffer.from(cookie, 'base64url')
    if (combined.length < IV_LENGTH + TAG_LENGTH) return null

    const iv = combined.subarray(0, IV_LENGTH)
    const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')

    return JSON.parse(decrypted) as OAuthStatePayload
  } catch {
    return null
  }
}

/**
 * Verify a state cookie against the current session.
 *
 * Throws an {@link OAuthStateError} with a stable `code` field on any check
 * failure so route handlers can map to consistent HTTP responses + redirect
 * flash codes.
 */
export function verifyOAuthState(input: {
  cookie: string | null | undefined
  expectedUserId: string
  expectedProviderKey?: string
  expectedState?: string
  now?: number
}): OAuthStatePayload {
  if (!input.cookie) {
    throw new OAuthStateError('Missing state cookie', 'invalid_cookie')
  }
  const payload = decryptOAuthState(input.cookie)
  if (!payload) {
    throw new OAuthStateError('Invalid state cookie', 'decrypt_failed')
  }
  const now = input.now ?? Date.now()
  if (payload.expiresAt < now) {
    throw new OAuthStateError('State cookie expired', 'expired')
  }
  if (payload.userId !== input.expectedUserId) {
    throw new OAuthStateError('State cookie userId mismatch', 'user_mismatch')
  }
  if (input.expectedProviderKey && payload.providerKey !== input.expectedProviderKey) {
    throw new OAuthStateError('State cookie providerKey mismatch', 'invalid_cookie')
  }
  if (input.expectedState && payload.state !== input.expectedState) {
    throw new OAuthStateError('State cookie state nonce mismatch', 'invalid_cookie')
  }
  return payload
}

/**
 * Create a fresh state payload + matching `state` query parameter. PKCE
 * verifiers are NOT generated here — the provider adapter decides whether it
 * needs PKCE and packs the verifier into `extra` itself.
 */
export function createOAuthState(params: {
  userId: string
  tenantId: string
  organizationId?: string | null
  providerKey: string
  returnUrl?: string
  extra?: Record<string, unknown>
}): { payload: OAuthStatePayload; cookie: string; stateParam: string } {
  const state = crypto.randomBytes(32).toString('base64url')
  const nonce = crypto.randomBytes(16).toString('base64url')
  const payload: OAuthStatePayload = {
    state,
    nonce,
    userId: params.userId,
    tenantId: params.tenantId,
    organizationId: params.organizationId ?? null,
    providerKey: params.providerKey,
    returnUrl: params.returnUrl,
    extra: params.extra,
    expiresAt: Date.now() + COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS,
  }
  const cookie = encryptOAuthState(payload)
  return { payload, cookie, stateParam: state }
}
