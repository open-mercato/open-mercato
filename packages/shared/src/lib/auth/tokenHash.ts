import crypto from 'node:crypto'

/**
 * Deterministic SHA-256 hash of a bearer token.
 *
 * Used for storing one-way hashes of high-entropy random tokens (sessions,
 * password resets, message access tokens, quote acceptance tokens) so that a
 * database leak does not expose usable credentials.
 *
 * SHA-256 is appropriate here (vs bcrypt) because:
 * - tokens are 256 bits of CSPRNG output (no brute-force surface)
 * - lookup is by-hash equality on an indexed column (must be deterministic)
 * - bcrypt would force a full table scan per request
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Constant-time compare for two hex hashes.
 */
export function tokenHashEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
