// Constant-time secret comparison for header-based shared-secret authentication.
// Plain `===`/`!==` on strings short-circuits on the first mismatching byte and
// leaks the matching prefix length through CPU timing. The custom-domain
// `domain-check` and `domain-resolve` routes guard cross-tenant data with these
// header secrets, so the comparison MUST be constant-time.
//
// `crypto.timingSafeEqual` requires equal-length buffers (it throws otherwise).
// We always do a length check first; the resulting length leak is negligible
// compared to the byte-by-byte leak of plain `!==`.

import { timingSafeEqual } from 'node:crypto'

export function secretEqual(supplied: string | null | undefined, expected: string): boolean {
  if (typeof supplied !== 'string' || supplied.length === 0) return false
  if (typeof expected !== 'string' || expected.length === 0) return false
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
