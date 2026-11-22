import { randomBytes } from 'node:crypto'

/**
 * Opaque public tracking token. It is intentionally long and URL-safe; the
 * public tracking endpoint treats possession of the token as authorization to
 * read the order's non-sensitive status.
 */
export function createTrackingToken(): string {
  return randomBytes(24).toString('base64url')
}
