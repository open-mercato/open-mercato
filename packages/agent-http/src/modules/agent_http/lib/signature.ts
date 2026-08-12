/**
 * Callback signature verification for the generic HTTP connector.
 *
 * Two schemes, because between them they cover almost every webhook a provider
 * ships and neither can be inferred from the other:
 *
 *   hex            `X-Signature: 5d41402abc…`          bare lowercase hex digest
 *   sha256_prefix  `X-Signature: sha256=5d41402abc…`   the GitHub/Shopify-style prefix
 *
 * Both are HMAC-SHA256 over the RAW request body with the tenant's shared secret.
 *
 * Three rules here are security-load-bearing and are why this file is separate,
 * pure and directly unit-tested:
 *
 *  1. **RAW BYTES ONLY.** The digest covers what was sent. The callback route
 *     hands the connector the exact received body string, and this function
 *     concatenates nothing and re-serialises nothing:
 *     `JSON.stringify(JSON.parse(body))` differs from `body` in whitespace and key
 *     order, so it would break every real signature while still passing a test
 *     that round-trips its own fixture.
 *  2. **TIMING-SAFE COMPARE.** `===` on a hex digest leaks a per-byte match
 *     through response timing.
 *  3. **NEVER THROWS.** Every malformed input is `false`. The route's "an
 *     exception during verification is a failure to verify" arm stays a
 *     belt-and-braces guard rather than the primary path.
 *
 * WHY THERE IS NO REPLAY WINDOW HERE, unlike the ElevenLabs connector. A
 * timestamp tolerance needs a timestamp, and there is no cross-provider
 * convention for where one lives — inventing a required header would make this
 * connector point at nothing that exists. Replay is instead bounded by the
 * platform: this connector is TOKEN-addressed, the token is single-use, and
 * settlement is a single-shot conditional UPDATE, so a captured callback replayed
 * later resolves the same row, finds it claimed and returns `already_settled`
 * without resuming anything a second time. A provider that DOES sign a timestamp
 * needs its own connector, which is exactly what this seam is for.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { GenericHttpSignatureScheme } from './credentials'

const SHA256_PREFIX = 'sha256='
const HEX_DIGEST_PATTERN = /^[0-9a-f]+$/

export type VerifyGenericHttpSignatureArgs = {
  /** Value of the configured signature header, exactly as received. */
  header: string | null | undefined
  /** The exact received body bytes, as a string. NEVER a re-serialised body. */
  rawBody: string
  /** This tenant's shared signing secret. */
  secret: string
  scheme: GenericHttpSignatureScheme
}

/**
 * Pull the presented digests out of a header value.
 *
 * Comma-separated values are all accepted and all checked, so a provider-side
 * secret rotation that briefly signs with two keys does not drop callbacks. A
 * value that does not match the configured scheme — a bare digest where a prefix
 * was configured, or the reverse — yields no digests, so verification fails. That
 * strictness is deliberate: accepting both shapes under either setting would make
 * the scheme credential decorative, and an operator who set the wrong one would
 * never find out.
 */
export function parseSignatureHeader(
  header: string | null | undefined,
  scheme: GenericHttpSignatureScheme,
): string[] {
  if (!header) return []
  const digests: string[] = []
  for (const rawPart of header.split(',')) {
    const part = rawPart.trim()
    if (!part.length) continue
    let candidate = part
    if (scheme === 'sha256_prefix') {
      if (!part.toLowerCase().startsWith(SHA256_PREFIX)) return []
      candidate = part.slice(SHA256_PREFIX.length).trim()
    }
    const normalized = candidate.toLowerCase()
    // Lower-cased before the check because the compare below is byte-wise: an
    // upper-case hex digest is the same digest and must not be rejected on
    // presentation alone.
    if (!HEX_DIGEST_PATTERN.test(normalized)) return []
    digests.push(normalized)
  }
  return digests
}

/**
 * Returns `true` only when the header parses under the configured scheme and an
 * HMAC-SHA256 over the raw body matches one of the presented digests.
 */
export function verifyGenericHttpSignature(args: VerifyGenericHttpSignatureArgs): boolean {
  if (!args.secret) return false

  const digests = parseSignatureHeader(args.header, args.scheme)
  if (!digests.length) return false

  const expected = createHmac('sha256', args.secret).update(args.rawBody).digest('hex')
  return digests.some((candidate) => timingSafeEqualHex(expected, candidate))
}

/**
 * Build the header value a correctly-configured provider would send. Exported so
 * the integration's own tests — and an operator's smoke script — produce exactly
 * what the verifier expects, instead of a second, hand-written implementation of
 * the same rule that can drift from it.
 */
export function buildSignatureHeaderValue(args: {
  rawBody: string
  secret: string
  scheme: GenericHttpSignatureScheme
}): string {
  const digest = createHmac('sha256', args.secret).update(args.rawBody).digest('hex')
  return args.scheme === 'sha256_prefix' ? `${SHA256_PREFIX}${digest}` : digest
}

/**
 * Compare two lowercase hex digests without leaking a per-byte match.
 *
 * The length check in front is not a leak worth caring about: digest length is
 * fixed and public (64 hex characters for SHA-256), so a mismatch there reveals
 * only that the caller sent something that is not a SHA-256 digest.
 */
function timingSafeEqualHex(expected: string, candidate: string): boolean {
  if (expected.length !== candidate.length) return false
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(candidate, 'utf8'))
}
