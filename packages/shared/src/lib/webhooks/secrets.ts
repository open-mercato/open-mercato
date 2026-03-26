import { randomBytes } from 'node:crypto'

const SECRET_PREFIX = 'whsec_'
const SECRET_BYTES = 24

/** Generate a new webhook signing secret (whsec_ prefixed) */
export function generateWebhookSecret(): string {
  const bytes = randomBytes(SECRET_BYTES)
  return `${SECRET_PREFIX}${bytes.toString('base64')}`
}

/** Parse a whsec_ prefixed secret, returning the raw base64 secret */
export function parseWebhookSecret(secret: string): Buffer {
  if (secret.startsWith(SECRET_PREFIX)) {
    return Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64')
  }
  return Buffer.from(secret, 'base64')
}

/** Check if a string is a valid webhook secret format */
export function isValidWebhookSecret(secret: string): boolean {
  if (!secret.startsWith(SECRET_PREFIX)) return false
  const base64Part = secret.slice(SECRET_PREFIX.length)
  if (base64Part.length === 0) return false
  try {
    const decoded = Buffer.from(base64Part, 'base64')
    return decoded.length >= SECRET_BYTES
  } catch {
    return false
  }
}
