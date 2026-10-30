import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed tracking tokens for the open pixel and the click redirect.
 *
 * Both endpoints are PUBLIC — a recipient's mail client fetches them with no session — so the token
 * is the only thing standing between the endpoints and anybody who can type a URL. It therefore
 * carries everything the write needs, including the tenant and organization it belongs to: an
 * unauthenticated request has no scope of its own, and reading one from a query parameter would let
 * anyone write rows into any tenant.
 *
 * **No PII in the token.** It identifies the SEND — campaign, run, step — never the person. Those
 * are uuids, and anyone holding the token already received the message it belongs to.
 */

/**
 * `unsubscribe` shares this token machinery deliberately.
 *
 * It needs exactly the same properties as an open or a click — signed, public, scoped, carrying no PII —
 * and a second signing scheme would be a second thing to get wrong. The purpose is part of the signed
 * claims, so an open token cannot be replayed as an unsubscribe.
 */
export type TrackingPurpose = 'open' | 'click' | 'unsubscribe' | 'survey'

export type TrackingClaims = {
  tenantId: string
  organizationId: string
  campaignId: string
  runId: string
  stepId: string
  purpose: TrackingPurpose
  /**
   * The click target for a click, and the chosen SCORE for a survey answer.
   *
   * One signed slot rather than two, because a token has exactly one payload either way and a second
   * optional field would invite the question of what it means when both are set. A survey token is
   * therefore a link whose destination is an answer.
   */
  target?: string
}

/** Bumped only if the claim shape changes; an old token then stops verifying rather than misreading. */
export const TRACKING_TOKEN_VERSION = 1

/**
 * Domain separation.
 *
 * The signing key is derived from the configured secret with a purpose label, so a tracking token
 * can never be confused for — or forged from — anything else signed with the same secret.
 */
const KEY_LABEL = 'marketing_automation:tracking:v1'

function signingKey(secret: string): Buffer {
  return createHash('sha256').update(`${secret}\u0000${KEY_LABEL}`).digest()
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The shape our own encoder produces, and the ONLY shape accepted back.
 *
 * `Buffer.from(…, 'base64')` is lenient: it stops at `=` and silently discards everything after it, so a valid
 * signature followed by `=` and arbitrary text decodes to the same bytes and verifies. That made the signature
 * an unbounded slot for attacker-controlled characters — which is a forgery primitive wherever a token is
 * echoed or parsed downstream. Canonical-form checking closes it for every consumer at once.
 */
const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/

function fromBase64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}

/** The wire form: a compact claim set, so a token stays short enough for an email attribute. */
type WireClaims = {
  v: number
  t: string
  o: string
  c: string
  r: string
  s: string
  p: TrackingPurpose
  u?: string
}

function toWire(claims: TrackingClaims): WireClaims {
  const wire: WireClaims = {
    v: TRACKING_TOKEN_VERSION,
    t: claims.tenantId,
    o: claims.organizationId,
    c: claims.campaignId,
    r: claims.runId,
    s: claims.stepId,
    p: claims.purpose,
  }
  if (claims.target) wire.u = claims.target
  return wire
}

export function signTrackingToken(claims: TrackingClaims, secret: string): string {
  const body = base64url(JSON.stringify(toWire(claims)))
  const signature = base64url(createHmac('sha256', signingKey(secret)).update(body).digest())
  return `${body}.${signature}`
}

/**
 * Verifies a token and returns its claims, or null.
 *
 * Null for every reason a token can be unusable — tampered, wrong secret, wrong version, malformed
 * — because the caller's behaviour is the same in all of them and telling them apart in a public
 * response would only help somebody probing.
 */
/**
 * Verifies against ANY configured secret, so a key rotation does not break links already in inboxes.
 *
 * Tried in order, current first, which means the common case costs exactly one HMAC. See
 * `resolveTrackingSecrets` for why a token cannot simply be re-minted instead.
 */
export function verifyTrackingTokenWithAny(token: string, secrets: readonly string[]): TrackingClaims | null {
  for (const secret of secrets) {
    const claims = verifyTrackingToken(token, secret)
    if (claims) return claims
  }
  return null
}

export function verifyTrackingToken(token: string, secret: string): TrackingClaims | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!body || !signature) return null
  // Both halves must be canonical base64url. Without this a trailing `=` plus anything at all still verifies.
  if (!CANONICAL_BASE64URL.test(body) || !CANONICAL_BASE64URL.test(signature)) return null

  const expected = createHmac('sha256', signingKey(secret)).update(body).digest()
  const provided = fromBase64url(signature)
  /**
   * Re-encoded and compared as a STRING, which is what makes the check exact.
   *
   * The alphabet test above stops a trailing `=` and anything after it, but base64 of 32 bytes spends 43
   * characters on 258 bits: the last character carries two unused bits, so four different strings decode to the
   * same signature. Round-tripping admits exactly one spelling — the one we mint.
   */
  if (base64url(provided) !== signature) return null
  // Length has to match before `timingSafeEqual`, which throws on a mismatch.
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  let wire: WireClaims
  try {
    wire = JSON.parse(fromBase64url(body).toString('utf8')) as WireClaims
  } catch {
    return null
  }
  if (wire?.v !== TRACKING_TOKEN_VERSION) return null
  if (wire.p !== 'open' && wire.p !== 'click' && wire.p !== 'unsubscribe' && wire.p !== 'survey') return null
  for (const value of [wire.t, wire.o, wire.c, wire.r, wire.s]) {
    if (typeof value !== 'string' || !value) return null
  }
  if (wire.u !== undefined && typeof wire.u !== 'string') return null

  return {
    tenantId: wire.t,
    organizationId: wire.o,
    campaignId: wire.c,
    runId: wire.r,
    stepId: wire.s,
    purpose: wire.p,
    target: wire.u,
  }
}

/**
 * Whether a click target may be redirected to.
 *
 * The signature proves WE minted the target, not that it is safe: an author writes the links, and a
 * `javascript:` or `data:` href in a campaign body would otherwise become a signed redirect that
 * looks like it came from the shop. Checked again at redirect time rather than only at signing time,
 * because the check is the cheap half and the consequence of skipping it is an XSS vector.
 */
export function isSafeRedirectTarget(target: string | undefined | null): boolean {
  if (!target) return false
  try {
    const url = new URL(target)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
