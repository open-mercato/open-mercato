export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000

export const pendingSignup = {
  isActive: true,
  emailVerifiedAt: null,
  lastLoginAt: null,
  deletedAt: null,
} as const

export function signupExpiryCutoff(now: Date): Date {
  return new Date(now.getTime() - EMAIL_VERIFICATION_TTL_MS)
}
