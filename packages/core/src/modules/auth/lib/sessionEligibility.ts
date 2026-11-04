const SESSION_REJECTED_MARKER = Symbol.for('@open-mercato/auth/AuthSessionRejectedError')

export class AuthSessionRejectedError extends Error {
  readonly [SESSION_REJECTED_MARKER] = true

  constructor() {
    super('[internal] Session eligibility rejected')
    this.name = 'AuthSessionRejectedError'
  }
}

export function isAuthSessionRejectedError(error: unknown): error is AuthSessionRejectedError {
  return error !== null && typeof error === 'object'
    && (error as Record<symbol, unknown>)[SESSION_REJECTED_MARKER] === true
}
