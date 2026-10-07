/**
 * Forms distribution token primitives — phase 2d.
 *
 * Two token kinds live here:
 *
 *  1. The stateless **submission access token** that authorizes an
 *     unauthenticated participant to run save/submit against exactly one
 *     submission, in exactly one role. It mirrors the phase 1d resume-token
 *     format (compact, no JWT to avoid header/cookie collisions):
 *
 *       base64url(submissionId).base64url(invitationId).role.exp.hmac
 *
 *     where `hmac = HMAC-SHA256(secret, payload)` over the full dotted body
 *     up to (but excluding) the hmac segment. The two UUIDs are base64url
 *     encoded so a stray dot in the body can never collide with the
 *     separators; `role` and `exp` are dot-safe by construction.
 *
 *     The org/tenant are NEVER encoded in — and never trusted from — the
 *     token. They are re-derived from the persisted submission row downstream
 *     (see `lib/runtime-principal.ts`), per R-2d-4.
 *
 *  2. The **personal invitation token** — a high-entropy raw string handed to
 *     a recipient once. Only its SHA-256 hash is persisted (`token_hash`);
 *     `hashInvitationToken` produces that hash and `generateRawInvitationToken`
 *     mints the raw value.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const DEFAULT_ACCESS_TOKEN_TTL_S = 86_400
const DEFAULT_INVITATION_TOKEN_TTL_S = 1_209_600

export type AccessTokenRole = string | null

export type SignAccessTokenArgs = {
  submissionId: string
  invitationId: string
  role: AccessTokenRole
  expiresAtSeconds: number
}

export type VerifyAccessTokenResult = {
  ok: boolean
  submissionId?: string
  invitationId?: string
  role?: string | null
  reason?: string
}

const ROLE_NULL_SENTINEL = '-'

export function getSecret(): string {
  const secret = process.env.FORMS_DISTRIBUTION_TOKEN_SECRET ?? process.env.JWT_SECRET ?? ''
  if (!secret) {
    throw new Error('FORMS_DISTRIBUTION_TOKEN_SECRET (or JWT_SECRET fallback) must be set.')
  }
  return secret
}

export function getAccessTokenTtlSeconds(): number {
  const raw = process.env.FORMS_ACCESS_TOKEN_TTL_S
  if (!raw) return DEFAULT_ACCESS_TOKEN_TTL_S
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ACCESS_TOKEN_TTL_S
}

export function getInvitationTokenTtlSeconds(): number {
  const raw = process.env.FORMS_INVITATION_TOKEN_TTL_S
  if (!raw) return DEFAULT_INVITATION_TOKEN_TTL_S
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INVITATION_TOKEN_TTL_S
}

function encodeSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeSegment(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function encodeRole(role: AccessTokenRole): string {
  if (role === null || role === undefined || role.length === 0) return ROLE_NULL_SENTINEL
  return encodeSegment(role)
}

function decodeRole(segment: string): string | null {
  if (segment === ROLE_NULL_SENTINEL) return null
  const decoded = decodeSegment(segment)
  return decoded.length === 0 ? null : decoded
}

export function signAccessToken(args: SignAccessTokenArgs): string {
  const submissionSegment = encodeSegment(args.submissionId)
  const invitationSegment = encodeSegment(args.invitationId)
  const roleSegment = encodeRole(args.role)
  const expSegment = String(args.expiresAtSeconds)
  const payload = `${submissionSegment}.${invitationSegment}.${roleSegment}.${expSegment}`
  const hmac = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${hmac}`
}

export function verifyAccessToken(token: string): VerifyAccessTokenResult {
  const parts = token.split('.')
  if (parts.length !== 5) return { ok: false, reason: 'malformed' }
  const [submissionSegment, invitationSegment, roleSegment, expSegment, hmac] = parts
  const exp = Number.parseInt(expSegment, 10)
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed_exp' }
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' }

  const payload = `${submissionSegment}.${invitationSegment}.${roleSegment}.${expSegment}`
  const expected = createHmac('sha256', getSecret()).update(payload).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(hmac, 'hex')
  if (expectedBuf.length !== actualBuf.length) return { ok: false, reason: 'signature' }
  if (!timingSafeEqual(expectedBuf, actualBuf)) return { ok: false, reason: 'signature' }

  let submissionId: string
  let invitationId: string
  let role: string | null
  try {
    submissionId = decodeSegment(submissionSegment)
    invitationId = decodeSegment(invitationSegment)
    role = decodeRole(roleSegment)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!submissionId || !invitationId) return { ok: false, reason: 'malformed' }
  return { ok: true, submissionId, invitationId, role }
}

/**
 * SHA-256 hex of the raw personal invitation token. Deterministic — the same
 * raw token always hashes to the same value, enabling a `token_hash` lookup.
 */
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

/**
 * Mint a URL-safe raw personal invitation token with ≥256 bits of entropy.
 * Shown to the recipient once; only its hash is persisted.
 */
export function generateRawInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Mint a URL-safe random public-link slug with ≥128 bits of entropy.
 */
export function generatePublicSlug(): string {
  return randomBytes(16).toString('base64url')
}
