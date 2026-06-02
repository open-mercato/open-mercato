import crypto from 'node:crypto'

/**
 * Spec C § Phase C2 — Verify a Gmail Pub/Sub push request.
 *
 * Pub/Sub push subscriptions authenticate with a Google-signed RS256 JWT
 * passed in the `Authorization: Bearer …` header. The token's claims contain
 *   - `iss`: `https://accounts.google.com`
 *   - `aud`: the configured audience (typically the webhook URL)
 *   - `email`: the publishing service-account address (e.g.
 *     `gmail-api-push@system.gserviceaccount.com` for Gmail watch)
 *   - `email_verified: true`
 *
 * The default verifier downloads Google's public x509 certs and caches them
 * for an hour. Tests inject a mock verifier via `setGmailPubSubVerifier(...)`.
 */

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs'
const CERT_CACHE_TTL_MS = 60 * 60 * 1000
const CERT_FETCH_TIMEOUT_MS = 5000
// Google mints OIDC tokens with one of these two issuer strings.
const GOOGLE_ACCEPTED_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

export interface GmailPubSubJwtClaims {
  iss: string
  aud: string | string[]
  email?: string
  emailVerified?: boolean
  exp: number
  iat: number
  sub?: string
}

export interface GmailPubSubVerifyInput {
  authorizationHeader: string | null | undefined
  expectedAudience: string
  expectedEmail: string
}

export interface GmailPubSubVerifier {
  verify(input: GmailPubSubVerifyInput): Promise<GmailPubSubJwtClaims>
}

export class GmailPubSubJwtError extends Error {
  readonly code: 'missing_token' | 'invalid_format' | 'invalid_signature' | 'expired' | 'wrong_issuer' | 'wrong_audience' | 'wrong_email' | 'fetch_certs_failed'
  constructor(message: string, code: GmailPubSubJwtError['code']) {
    super(message)
    this.name = 'GmailPubSubJwtError'
    this.code = code
  }
}

interface CertCacheEntry {
  certs: Record<string, string>
  fetchedAt: number
}

class FetchGmailPubSubVerifier implements GmailPubSubVerifier {
  private certCache: CertCacheEntry | null = null

  async verify(input: GmailPubSubVerifyInput): Promise<GmailPubSubJwtClaims> {
    const token = extractBearer(input.authorizationHeader)
    if (!token) throw new GmailPubSubJwtError('Missing Authorization bearer token', 'missing_token')

    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new GmailPubSubJwtError('JWT must have three dot-separated parts', 'invalid_format')
    }
    const [headerB64, payloadB64, signatureB64] = parts
    let header: Record<string, unknown>
    let claims: GmailPubSubJwtClaims
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8')) as Record<string, unknown>
      claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as GmailPubSubJwtClaims
    } catch {
      throw new GmailPubSubJwtError('JWT header/payload not parseable', 'invalid_format')
    }
    const kid = typeof header.kid === 'string' ? header.kid : null
    const alg = typeof header.alg === 'string' ? header.alg : null
    if (!kid || alg !== 'RS256') {
      throw new GmailPubSubJwtError(`Unsupported JWT alg/kid: alg=${alg ?? '?'} kid=${kid ?? '?'}`, 'invalid_format')
    }

    const certs = await this.getCerts()
    const cert = certs[kid]
    if (!cert) {
      // Cert rotated; refetch once and retry.
      this.certCache = null
      const refreshed = await this.getCerts()
      const fresh = refreshed[kid]
      if (!fresh) throw new GmailPubSubJwtError(`No cert for kid=${kid}`, 'invalid_signature')
      verifySignature(`${headerB64}.${payloadB64}`, signatureB64, fresh)
    } else {
      verifySignature(`${headerB64}.${payloadB64}`, signatureB64, cert)
    }

    validateClaims(claims, input)
    return claims
  }

  private async getCerts(): Promise<Record<string, string>> {
    if (this.certCache && Date.now() - this.certCache.fetchedAt < CERT_CACHE_TTL_MS) {
      return this.certCache.certs
    }
    let res: Response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CERT_FETCH_TIMEOUT_MS)
    try {
      res = await fetch(GOOGLE_CERTS_URL, { signal: controller.signal })
    } catch (err) {
      throw new GmailPubSubJwtError(
        `Failed to fetch Google certs: ${err instanceof Error ? err.message : String(err)}`,
        'fetch_certs_failed',
      )
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      throw new GmailPubSubJwtError(`Google certs endpoint returned ${res.status}`, 'fetch_certs_failed')
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch (err) {
      throw new GmailPubSubJwtError(
        `Google certs endpoint returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        'fetch_certs_failed',
      )
    }
    const certs = toCertMap(parsed)
    if (!certs) {
      // Never cache an empty/malformed payload — a single bad 200 would otherwise
      // disable Gmail push verification for the whole CERT_CACHE_TTL_MS window.
      throw new GmailPubSubJwtError('Google certs endpoint returned an unexpected shape', 'fetch_certs_failed')
    }
    this.certCache = { certs, fetchedAt: Date.now() }
    return certs
  }
}

/**
 * Validates that a parsed Google certs response is a non-empty `kid → PEM` map.
 * Returns the typed map on success, or `null` when the shape is unusable so the
 * caller can fail closed instead of caching garbage.
 */
function toCertMap(value: unknown): Record<string, string> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return null
  const certs: Record<string, string> = {}
  for (const [kid, pem] of entries) {
    if (typeof pem !== 'string' || pem.length === 0) return null
    certs[kid] = pem
  }
  return certs
}

function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

function verifySignature(input: string, signatureB64: string, cert: string): void {
  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(input)
  verifier.end()
  const signature = Buffer.from(signatureB64, 'base64url')
  const ok = verifier.verify(cert, signature)
  if (!ok) {
    throw new GmailPubSubJwtError('JWT signature verification failed', 'invalid_signature')
  }
}

function validateClaims(claims: GmailPubSubJwtClaims, input: GmailPubSubVerifyInput): void {
  const now = Math.floor(Date.now() / 1000)
  // Fail closed: a token without a numeric `exp` has no expiry, so a captured
  // push JWT could otherwise be replayed indefinitely. Require `exp` and reject
  // anything already past it (with a small clock-skew allowance).
  if (typeof claims.exp !== 'number' || claims.exp < now - 5) {
    throw new GmailPubSubJwtError('JWT expired or missing exp', 'expired')
  }
  // Reject a future-dated `iat` beyond the clock-skew allowance: a token
  // "issued" in the future signals a forged token or a badly-skewed clock.
  // Reuses the `expired` code (both are temporal-validity failures → 401).
  if (typeof claims.iat === 'number' && claims.iat > now + 5) {
    throw new GmailPubSubJwtError('JWT issued in the future', 'expired')
  }
  // Verify the issuer is Google (defense-in-depth alongside the signature +
  // service-account email checks; the file header documents this requirement).
  if (typeof claims.iss !== 'string' || !GOOGLE_ACCEPTED_ISSUERS.has(claims.iss)) {
    throw new GmailPubSubJwtError(
      `JWT issuer not accepted (got ${typeof claims.iss === 'string' ? claims.iss : 'none'})`,
      'wrong_issuer',
    )
  }
  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(input.expectedAudience)
    : claims.aud === input.expectedAudience
  if (!audOk) {
    throw new GmailPubSubJwtError(
      `JWT audience mismatch (expected ${input.expectedAudience})`,
      'wrong_audience',
    )
  }
  // Google uses `email_verified` in the wire format; our type uses camelCase.
  // Accept either to be defensive.
  const emailVerified =
    claims.emailVerified === true ||
    (claims as unknown as { email_verified?: boolean }).email_verified === true
  if (!emailVerified || claims.email !== input.expectedEmail) {
    throw new GmailPubSubJwtError(
      `JWT email mismatch (expected ${input.expectedEmail})`,
      'wrong_email',
    )
  }
}

let cachedVerifier: GmailPubSubVerifier | null = null

export function getGmailPubSubVerifier(): GmailPubSubVerifier {
  if (!cachedVerifier) cachedVerifier = new FetchGmailPubSubVerifier()
  return cachedVerifier
}

export function setGmailPubSubVerifier(verifier: GmailPubSubVerifier | null): void {
  cachedVerifier = verifier
}

/**
 * Decode a Pub/Sub envelope from the webhook body.
 *
 * Shape: `{ message: { data: base64<JSON>, messageId, publishTime, attributes }, subscription }`.
 *
 * Gmail's payload (`data` field) decodes to `{ emailAddress, historyId }`.
 */
export interface PubSubEnvelope {
  message: {
    data: string
    messageId: string
    publishTime?: string
    attributes?: Record<string, string>
  }
  subscription?: string
}

export interface GmailPushPayload {
  emailAddress: string
  historyId: string | number
}

export function decodeGmailPubSubBody(rawBody: string): GmailPushPayload {
  let envelope: PubSubEnvelope
  try {
    envelope = JSON.parse(rawBody) as PubSubEnvelope
  } catch {
    throw new GmailPubSubJwtError('Body is not valid JSON', 'invalid_format')
  }
  if (!envelope.message?.data) {
    throw new GmailPubSubJwtError('Envelope missing message.data', 'invalid_format')
  }
  let payloadText: string
  try {
    payloadText = Buffer.from(envelope.message.data, 'base64').toString('utf-8')
  } catch {
    throw new GmailPubSubJwtError('message.data not base64 decodable', 'invalid_format')
  }
  let payload: GmailPushPayload
  try {
    payload = JSON.parse(payloadText) as GmailPushPayload
  } catch {
    throw new GmailPubSubJwtError('message.data JSON not parseable', 'invalid_format')
  }
  if (!payload.emailAddress || payload.historyId === undefined) {
    throw new GmailPubSubJwtError('message.data missing emailAddress or historyId', 'invalid_format')
  }
  return payload
}
