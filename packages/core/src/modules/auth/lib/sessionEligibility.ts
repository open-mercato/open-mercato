import type { User } from '../data/entities'

const SESSION_REJECTED_MARKER = Symbol.for('@open-mercato/auth/AuthSessionRejectedError')

export type PasswordSessionProof = {
  kind: 'password'
  email: string
  passwordHash: string | null
}

export function capturePasswordSessionProof(user: Pick<User, 'email' | 'passwordHash'>): PasswordSessionProof {
  return { kind: 'password', email: user.email, passwordHash: user.passwordHash ?? null }
}

export function matchesPasswordSessionProof(user: User, proof: PasswordSessionProof): boolean {
  return user.isConfirmed !== false && proof.passwordHash !== null
    && user.email === proof.email && user.passwordHash === proof.passwordHash
}

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
