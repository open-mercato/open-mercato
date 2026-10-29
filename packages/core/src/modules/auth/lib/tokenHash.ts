import { createHmac, randomBytes } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const logger = createLogger('auth').child({ component: 'token-hash' })

const DEV_ONLY_SECRET = 'om-auth-token-dev-only-secret'
const DEV_FALLBACK_NODE_ENVS = new Set(['', 'development', 'test'])
let missingSecretWarned = false

function isDevFallbackAllowed(nodeEnv: string): boolean {
  if (DEV_FALLBACK_NODE_ENVS.has(nodeEnv)) return true
  return parseBooleanToken(process.env.OM_ALLOW_DEV_AUTH_SECRET) === true
}

function resolveTokenSecret(): string {
  const secret =
    process.env.AUTH_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET
  if (!secret) {
    const nodeEnv = (process.env.NODE_ENV ?? '').trim()
    if (nodeEnv === 'production') {
      throw new Error(
        '[auth.tokenHash] No AUTH_TOKEN_SECRET/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET set. ' +
        'Refusing to start in production without a token hashing secret.',
      )
    }
    if (!isDevFallbackAllowed(nodeEnv)) {
      throw new Error(
        `[auth.tokenHash] No AUTH_TOKEN_SECRET/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET set (NODE_ENV=${nodeEnv}). ` +
        'The insecure dev-only token hashing secret is only used when NODE_ENV is development or test. ' +
        'Set a token hashing secret, or set OM_ALLOW_DEV_AUTH_SECRET=true to opt in explicitly.',
      )
    }
    if (!missingSecretWarned) {
      missingSecretWarned = true
      logger.warn('No AUTH_TOKEN_SECRET/AUTH_SECRET/NEXTAUTH_SECRET/JWT_SECRET set — using insecure dev-only default. Set a secret before deploying to production.')
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

