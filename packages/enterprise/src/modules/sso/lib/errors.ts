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
