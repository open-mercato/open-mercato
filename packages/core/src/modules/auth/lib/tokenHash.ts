import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const DEFAULT_SECRET = 'om-auth-token-default-secret'
let missingSecretWarned = false

function resolveTokenSecret(): string {
  const secret =
    process.env.AUTH_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET
  if (!secret) {
    if (!missingSecretWarned) {
      missingSecretWarned = true
      console.warn(
        '[auth.tokenHash] No AUTH_TOKEN_SECRET/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET set — staff session/reset tokens fall back to an insecure default. Configure a secret before running in production.',
      )
    }
    return DEFAULT_SECRET
  }
  return secret
}

export function generateAuthToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashAuthToken(rawToken: string): string {
  return createHmac('sha256', resolveTokenSecret()).update(rawToken).digest('hex')
}

export function safeCompareAuthTokenHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
