import { createHash, randomBytes } from 'node:crypto'

// §4.1/§13 (C4, D-R4-18): the session token is the only credential an anonymous buyer
// holds for `/api/checkout/sessions/current/*`. It MUST be 32+ bytes of CSPRNG entropy,
// base64url-encoded, and NEVER persisted in plaintext — only its SHA-256 hex hash lands on
// `CheckoutSession.tokenHash`. The plaintext token is returned exactly once, in the
// `POST /api/checkout/sessions` response body, and never again (never logged either).
//
// Same algorithm/encoding as the cart's own `cart/lib/token.ts#hashCartToken` (so both
// modules' token columns are byte-for-byte comparable in form, even though they hash two
// different credentials) — reimplemented here, not imported, per the spec's own "checkout
// imports nothing from cart/lib" rule (§6).

const TOKEN_ENTROPY_BYTES = 32

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export type GeneratedCheckoutSessionToken = {
  /** Plaintext token — returned to the caller exactly once, never persisted or logged. */
  token: string
  /** SHA-256 (hex) of `token` — the only form ever written to `CheckoutSession.tokenHash`. */
  tokenHash: string
}

/** Generates a new opaque checkout session token (32+ bytes CSPRNG, base64url). */
export function generateCheckoutSessionToken(): GeneratedCheckoutSessionToken {
  const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url')
  return { token, tokenHash: sha256Hex(token) }
}

/** Re-hashes a presented token for lookup against `CheckoutSession.tokenHash`. */
export function hashCheckoutSessionToken(token: string): string {
  return sha256Hex(token)
}

/**
 * Hashes a presented `X-Cart-Token` the SAME way `cart/lib/token.ts#hashCartToken` does
 * (SHA-256, hex), so `lib/cartPeer.ts`'s scope-free `carts.token_hash` lookup can compare
 * against it. Deliberately duplicated rather than imported — see this file's header note.
 */
export function hashCartTokenForLookup(token: string): string {
  return sha256Hex(token)
}
