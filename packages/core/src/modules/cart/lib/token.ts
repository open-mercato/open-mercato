import { createHash, randomBytes } from 'node:crypto'

// §8.3 (Token security): the cart token is the only credential an anonymous buyer holds.
// It MUST be 32+ bytes of CSPRNG entropy, base64url-encoded, and NEVER persisted in
// plaintext — only its hash lands on `Cart.tokenHash` (§4.1, C13/D-R4-18). The plaintext
// token is returned exactly once, in the `cart.create` response body, and never again.

const TOKEN_ENTROPY_BYTES = 32

// Hash choice (documented per the task): SHA-256, hex-encoded. Hex rather than base64url
// for the hash keeps it trivially distinguishable from the base64url-encoded plaintext
// token in logs/diffs and matches this column's existing `text` type with no padding
// characters to worry about. `hashCartToken` MUST use the exact same algorithm/encoding
// so a presented token's hash is always comparable against a stored `Cart.tokenHash`.
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export type GeneratedCartToken = {
  /** Plaintext token — returned to the caller exactly once, never persisted or logged. */
  token: string
  /** SHA-256 (hex) of `token` — the only form ever written to `Cart.tokenHash`. */
  tokenHash: string
}

/**
 * Generates a new opaque cart token: 32+ bytes of CSPRNG entropy, base64url-encoded.
 * Returns both the plaintext (never persisted) and its hash (what `Cart.tokenHash` stores).
 */
export function generateCartToken(): GeneratedCartToken {
  const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url')
  return { token, tokenHash: sha256Hex(token) }
}

/**
 * Re-hashes a presented token for lookup against `Cart.tokenHash`. Every subsequent
 * request after creation MUST resolve a cart this way — never by comparing a stored
 * plaintext, because none is ever stored (§8.3).
 */
export function hashCartToken(token: string): string {
  return sha256Hex(token)
}
