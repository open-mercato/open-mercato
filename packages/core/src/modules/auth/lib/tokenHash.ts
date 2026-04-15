import { createHmac, randomBytes } from 'node:crypto'

const DEV_ONLY_SECRET = 'om-auth-token-dev-only-secret'
let missingSecretWarned = false

function resolveTokenSecret(): string {
  const secret =
    process.env.AUTH_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[auth.tokenHash] No AUTH_TOKEN_SECRET/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET set. ' +
        'Refusing to start in production without a token hashing secret.',
      )
    }
    if (!missingSecretWarned) {
      missingSecretWarned = true
      console.warn(
        '[auth.tokenHash] No AUTH_TOKEN_SECRET/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET set — ' +
        'using insecure dev-only default. Set a secret before deploying to production.',
      )
    }
    return DEV_ONLY_SECRET
  }
  return secret
}

export function generateAuthToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashAuthToken(rawToken: string): string {
  return createHmac('sha256', resolveTokenSecret()).update(rawToken).digest('hex')
}

