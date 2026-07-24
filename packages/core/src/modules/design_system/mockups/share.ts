import crypto from 'node:crypto'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { findRepoRoot, getMockupBySlug, type LoadedMockup } from './loader'

/**
 * Tokenized read-only share links (spec 2026-07-05-ds-live-mockup-composer.md,
 * Phase 2 — Share links). Security constraints, enumerated in the spec:
 *
 * 1. A token authorizes exactly one slug — no list, no other mockups, no
 *    write route accepts it.
 * 2. Invalid, expired, or tampered tokens are indistinguishable from unknown
 *    slugs: `resolveSharedMockup` returns one uniform failure shape and the
 *    route answers 404 for all of them (no oracle).
 * 3. The public route is rate-limited per IP (config below, fail-open like
 *    the other public surfaces).
 * 4. Sharing is disabled entirely without `MOCKUP_SHARE_SECRET` — minting
 *    returns 503, verification always fails; no fallback scheme.
 * 5. Revocation is by secret rotation (invalidates all outstanding links) —
 *    documented limitation; expiry is short and content is committed sample
 *    data by construction.
 *
 * Token format: `base64url(payloadJson).base64url(hmacSha256(payloadB64))`
 * with payload `{ slug, exp }` (exp = unix seconds). Server-only (node:crypto).
 */

export const MOCKUP_SHARE_SECRET_ENV = 'MOCKUP_SHARE_SECRET'
export const SHARE_DEFAULT_EXPIRY_DAYS = 7
export const SHARE_MAX_EXPIRY_DAYS = 30

export type ShareTokenPayload = { slug: string; exp: number }

export function getShareSecret(): string | null {
  const secret = process.env[MOCKUP_SHARE_SECRET_ENV]
  return secret && secret.trim().length > 0 ? secret : null
}

function signPayload(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64, 'utf8').digest('base64url')
}

export function mintShareToken(
  slug: string,
  expiresInDays: number,
  secret: string,
  now: Date = new Date(),
): { token: string; expiresAt: string } {
  const days = Math.min(Math.max(expiresInDays, 1), SHARE_MAX_EXPIRY_DAYS)
  const exp = Math.floor(now.getTime() / 1000) + days * 24 * 60 * 60
  const payload: ShareTokenPayload = { slug, exp }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const token = `${payloadB64}.${signPayload(payloadB64, secret)}`
  return { token, expiresAt: new Date(exp * 1000).toISOString() }
}

export type ShareVerification = { ok: true; slug: string } | { ok: false }

const SHARE_FAILURE: ShareVerification = { ok: false }

/**
 * Uniform verification: every failure class (malformed, tampered, expired,
 * missing secret) returns the SAME object shape with no distinguishing detail.
 */
export function verifyShareToken(
  token: string,
  secret: string | null,
  now: Date = new Date(),
): ShareVerification {
  if (!secret) return SHARE_FAILURE
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return SHARE_FAILURE
  const parts = token.split('.')
  if (parts.length !== 2) return SHARE_FAILURE
  const [payloadB64, signature] = parts
  const expected = signPayload(payloadB64, secret)
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const actualBuffer = Buffer.from(signature, 'utf8')
  if (expectedBuffer.length !== actualBuffer.length) return SHARE_FAILURE
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return SHARE_FAILURE
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return SHARE_FAILURE
  }
  const record = payload as { slug?: unknown; exp?: unknown } | null
  if (!record || typeof record.slug !== 'string' || typeof record.exp !== 'number') {
    return SHARE_FAILURE
  }
  if (record.exp <= Math.floor(now.getTime() / 1000)) return SHARE_FAILURE
  return { ok: true, slug: record.slug }
}

export type SharedMockupResolution = { ok: true; mockup: LoadedMockup } | { ok: false }

/**
 * The handler-level lookup behind `GET /api/design_system/mockup-share/[token]`:
 * verify the token, then resolve its single slug. Expired, tampered, and
 * wrong-document tokens all collapse into the same `{ ok: false }` → 404.
 */
export function resolveSharedMockup(
  token: string,
  secret: string | null,
  repoRoot: string | null = findRepoRoot(),
  now: Date = new Date(),
): SharedMockupResolution {
  const verified = verifyShareToken(token, secret, now)
  if (!verified.ok) return { ok: false }
  const mockup = getMockupBySlug(verified.slug, repoRoot)
  if (!mockup || !mockup.document) return { ok: false }
  return { ok: true, mockup }
}

/** Public share-view rate limit — fail-open per the platform convention. */
export const mockupShareViewRateLimitConfig = readEndpointRateLimitConfig('MOCKUP_SHARE_VIEW', {
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'mockup-share-view',
})
