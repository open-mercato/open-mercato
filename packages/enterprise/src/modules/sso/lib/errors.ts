// Use Symbol.for so the marker survives module duplication across bundle
// boundaries: the OIDC callback route and the account-linking service can be
// bundled into separate chunks where `instanceof` silently returns false
// (same rationale as isCrudHttpError in @open-mercato/shared).
const EMAIL_NOT_VERIFIED_ERROR_MARKER = Symbol.for('@open-mercato/sso/EmailNotVerifiedError')

export class EmailNotVerifiedError extends Error {
  readonly [EMAIL_NOT_VERIFIED_ERROR_MARKER] = true

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EmailNotVerifiedError'
  }
}

/**
 * Type-safe check that works across module/bundle boundaries. Prefer this over
 * `instanceof EmailNotVerifiedError` because the SSO callback route may be
 * bundled separately from the service that throws the error.
 */
export function isEmailNotVerifiedError(err: unknown): err is EmailNotVerifiedError {
  return !!err && typeof err === 'object' && (err as Record<symbol, unknown>)[EMAIL_NOT_VERIFIED_ERROR_MARKER] === true
}

export type SsoHttpErrorLike = Error & { statusCode: number }

/**
 * Cross-bundle check for SSO's typed HTTP errors. A route may load a different
 * module copy than the service that threw, so match the `Symbol.for` brand or
 * the stable error name with a numeric HTTP status instead of `instanceof`.
 */
export function isBrandedSsoHttpError(err: unknown, marker: symbol, name: string): err is SsoHttpErrorLike {
  if (!err || typeof err !== 'object') return false
  const candidate = err as Record<PropertyKey, unknown>
  const statusCode = candidate.statusCode
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) return false
  if (typeof candidate.message !== 'string') return false
  return candidate[marker] === true || candidate.name === name
}

const SSO_ROLES_REVOKED_ERROR_MARKER = Symbol.for('@open-mercato/sso/SsoRolesRevokedError')

/**
 * Login denial raised after the IdP resolved no mapped roles. The revoked SSO
 * grants are already committed; `userId` lets the caller drop cached RBAC for
 * sessions that still hold the revoked roles.
 */
export class SsoRolesRevokedError extends Error {
  readonly [SSO_ROLES_REVOKED_ERROR_MARKER] = true

  constructor(readonly userId: string, message: string) {
    super(message)
    this.name = 'SsoRolesRevokedError'
  }
}

export function isSsoRolesRevokedError(err: unknown): err is SsoRolesRevokedError {
  return !!err && typeof err === 'object' && (err as Record<symbol, unknown>)[SSO_ROLES_REVOKED_ERROR_MARKER] === true
}

export type SsoCallbackErrorCode = 'sso_email_not_verified' | 'sso_failed'

/**
 * Maps an error thrown during the OIDC callback to the login-page UX error code.
 * Keyed off the error type rather than a substring of the human-readable message,
 * which previously drifted out of sync and left `sso_email_not_verified`
 * unreachable (#2741).
 */
export function resolveSsoCallbackErrorCode(err: unknown): SsoCallbackErrorCode {
  return isEmailNotVerifiedError(err) ? 'sso_email_not_verified' : 'sso_failed'
}

export type SsoErrorTranslationParams = Record<string, string | number>

export interface SsoErrorTranslation {
  key: string
  params?: SsoErrorTranslationParams
}

/**
 * Reads the translation descriptor carried by a typed SSO HTTP error. Duck-typed
 * so an error thrown by another bundled module copy still resolves its key.
 */
export function readSsoErrorTranslation(err: unknown): SsoErrorTranslation | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as Record<string, unknown>
  const key = candidate.translationKey
  if (typeof key !== 'string' || !key) return null
  const rawParams = candidate.translationParams
  if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) return { key }
  const params: SsoErrorTranslationParams = {}
  for (const [name, value] of Object.entries(rawParams as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value
  }
  return { key, params }
}
