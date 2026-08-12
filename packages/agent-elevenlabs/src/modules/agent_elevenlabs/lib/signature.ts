/**
 * ElevenLabs post-call webhook signature verification.
 *
 * Header: `ElevenLabs-Signature: t=<unix_seconds>,v0=<hex>`
 * Canonical string: `` `${timestamp}.${rawBody}` ``
 * Digest: HMAC-SHA256 with the workspace webhook secret, hex.
 * Replay window: reject a timestamp older than 1800 seconds.
 *
 * Three rules here are security-load-bearing and are the reason this file is
 * separate, pure and directly unit-tested:
 *
 *  1. **RAW BYTES ONLY.** The digest covers what was sent. The callback route
 *     (T2.6) is careful to hand the connector the exact received body string and
 *     never a re-serialised one, and this function must be equally careful to
 *     concatenate it verbatim: `JSON.stringify(JSON.parse(body))` differs from
 *     `body` in whitespace and key order, and would break every real signature
 *     while still passing a test that round-trips its own fixture.
 *  2. **TIMING-SAFE COMPARE.** `===` on a hex digest leaks a per-byte match
 *     through response timing.
 *  3. **THE REPLAY WINDOW IS OURS TO ENFORCE.** The route deliberately performs
 *     no timestamp check of its own — only the provider's package knows its
 *     header format — so if this function does not reject a stale timestamp,
 *     nothing does, and a captured callback stays replayable forever.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** ElevenLabs' documented tolerance. */
export const ELEVENLABS_SIGNATURE_TOLERANCE_SECONDS = 1800

export const ELEVENLABS_SIGNATURE_HEADER = 'elevenlabs-signature'

type ParsedSignatureHeader = {
  timestampSeconds: number
  digests: string[]
}

/**
 * Parse `t=<unix_seconds>,v0=<hex>`.
 *
 * Multiple `v0=` parts are tolerated and all are checked, so a provider-side
 * secret rotation that briefly signs with two keys does not drop callbacks. A
 * missing `t`, a missing `v0`, a non-integer `t` or a non-hex digest all return
 * `null` — a malformed header is never "probably fine".
 */
export function parseElevenLabsSignatureHeader(header: string | null | undefined): ParsedSignatureHeader | null {
  if (!header) return null

  let timestampSeconds: number | null = null
  const digests: string[] = []

  for (const rawPart of header.split(',')) {
    const part = rawPart.trim()
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator)
    const value = part.slice(separator + 1)

    if (key === 't') {
      if (!/^\d+$/.test(value)) return null
      const parsed = Number.parseInt(value, 10)
      if (!Number.isSafeInteger(parsed)) return null
      timestampSeconds = parsed
      continue
    }

    if (key === 'v0') {
      const normalized = value.toLowerCase()
      // Lower-cased before the check because the compare below is byte-wise:
      // an upper-case hex digest is the same digest and must not be rejected on
      // presentation alone.
      if (!/^[0-9a-f]+$/.test(normalized)) return null
      digests.push(normalized)
    }
  }

  if (timestampSeconds === null || digests.length === 0) return null
  return { timestampSeconds, digests }
}

export type VerifyElevenLabsSignatureArgs = {
  /** Value of the `ElevenLabs-Signature` header, exactly as received. */
  header: string | null | undefined
  /** The exact received body bytes, as a string. NEVER a re-serialised body. */
  rawBody: string
  /** This tenant's ElevenLabs webhook secret. */
  secret: string
  /** Injected for tests; defaults to the wall clock. */
  nowMs?: number
  toleranceSeconds?: number
}

/**
 * Returns `true` only when the header parses, the timestamp is inside the replay
 * window, and an HMAC over `${t}.${rawBody}` matches one of the presented
 * digests. Every other outcome is `false` — this function never throws, so the
 * route's "an exception during verification is a failure to verify" arm stays a
 * belt-and-braces guard rather than the primary path.
 */
export function verifyElevenLabsSignature(args: VerifyElevenLabsSignatureArgs): boolean {
  if (!args.secret) return false

  const parsed = parseElevenLabsSignatureHeader(args.header)
  if (!parsed) return false

  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000)
  const tolerance = args.toleranceSeconds ?? ELEVENLABS_SIGNATURE_TOLERANCE_SECONDS
  // Only the PAST is bounded, per ElevenLabs' documented rule. A future
  // timestamp needs the secret to be signed at all, so it buys an attacker
  // nothing, while bounding it would turn ordinary clock skew between the
  // provider and this deployment into dropped callbacks and parked workflows.
  if (nowSeconds - parsed.timestampSeconds > tolerance) return false

  const expected = createHmac('sha256', args.secret)
    .update(`${parsed.timestampSeconds}.${args.rawBody}`)
    .digest('hex')

  return parsed.digests.some((candidate) => timingSafeEqualHex(expected, candidate))
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
