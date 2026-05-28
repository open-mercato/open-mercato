import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadToken } from '../data/entities'

/**
 * Per-thread crypto token used by the layered thread-matcher to attach
 * inbound replies to the originating Open Mercato message thread, even
 * when the recipient's mail client strips RFC 5322 headers.
 *
 * Token format: `om_<22b64url>_<11b64url>` — 16 random bytes followed by
 * 8 bytes of HMAC-SHA256(random, key), each base64url-encoded without
 * padding. Approximately 37 characters total.
 *
 * Tokens are stored on the `channel_thread_tokens` table keyed by
 * `(tenantId, token)` so that even if the HMAC key leaked, tenant
 * isolation still holds at the DB layer.
 *
 * See `.ai/specs/2026-05-27-email-integration-inbound-reliability-and-threading.md`.
 */

const TOKEN_PREFIX = 'om_'
const RANDOM_BYTES = 16
const HMAC_BYTES = 8
const HMAC_KEY_ENV = 'OM_THREAD_TOKEN_SECRET'
const HMAC_FALLBACK_KEY_ENV = 'KMS_MASTER_KEY'
const HMAC_KEY_INFO = 'thread-token'

/**
 * Pre-validated regex for parsing token candidates extracted from headers
 * or body content. Matches our exact format and rejects anything else
 * before HMAC verification — defense in depth.
 */
const TOKEN_REGEX = /om_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{11}/

let cachedKey: Buffer | null = null

/** Resolve the HMAC key. Falls back through env vars per the spec. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const primary = process.env[HMAC_KEY_ENV]
  if (primary && primary.length > 0) {
    cachedKey = Buffer.from(primary, 'utf8')
    return cachedKey
  }
  const fallback = process.env[HMAC_FALLBACK_KEY_ENV]
  if (fallback && fallback.length > 0) {
    // HKDF-style: derive a per-purpose subkey by HMAC-ing the fallback secret
    // with a constant info label so different purposes don't share a key.
    cachedKey = createHmac('sha256', fallback).update(HMAC_KEY_INFO).digest()
    return cachedKey
  }
  // No secret configured. Fail closed in production rather than signing thread
  // tokens with a public static key (which would let anyone forge a thread
  // token). In non-production we fall back to a dev-only static key and warn.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[communication_channels] No ${HMAC_KEY_ENV} or ${HMAC_FALLBACK_KEY_ENV} configured —` +
        ' refusing to sign thread tokens with a static dev key in production.',
    )
  }
  console.warn(
    `[communication_channels] No ${HMAC_KEY_ENV} or ${HMAC_FALLBACK_KEY_ENV} configured.` +
      ' Thread tokens will use a dev-only static key — DO NOT USE IN PRODUCTION.',
  )
  cachedKey = createHash('sha256').update('open-mercato-thread-token-dev').digest()
  return cachedKey
}

/** Reset the cached key — for tests that mutate env vars. */
export function _resetThreadTokenKeyCache(): void {
  cachedKey = null
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64urlDecode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  try {
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  } catch {
    return null
  }
}

function computeHmacBytes(random: Buffer): Buffer {
  return createHmac('sha256', getKey()).update(random).digest().subarray(0, HMAC_BYTES)
}

/**
 * Generate a new HMAC-signed thread token. Tokens are randomly distributed
 * so callers don't need to dedupe per thread — the DB unique constraint
 * `(tenantId, token)` plus an upsert pattern handles the rare collision.
 */
export function generateToken(): string {
  const random = randomBytes(RANDOM_BYTES)
  const hmac = computeHmacBytes(random)
  return `${TOKEN_PREFIX}${base64urlEncode(random)}_${base64urlEncode(hmac)}`
}

// Fixed lengths of the base64url-encoded components, without padding.
// Computed once: 16 bytes -> 22 chars, 8 bytes -> 11 chars.
const RANDOM_B64_LEN = Math.ceil((RANDOM_BYTES * 4) / 3)
const HMAC_B64_LEN = Math.ceil((HMAC_BYTES * 4) / 3)
const TOKEN_TOTAL_LEN = TOKEN_PREFIX.length + RANDOM_B64_LEN + 1 + HMAC_B64_LEN

/**
 * Verify the HMAC signature on a token. Returns `true` only when the
 * structural form is correct AND the HMAC matches under the current key.
 *
 * Does NOT verify the token exists in the DB — that lookup is the
 * matcher's responsibility (see `thread-matcher.ts`). Verifying here
 * lets us drop forged tokens before any DB I/O.
 *
 * Parsing note: base64url-encoded random/HMAC portions may themselves
 * contain `_` characters, so `split('_')` is unsafe. We parse positionally
 * using the fixed lengths declared above.
 */
export function verifyToken(token: string): boolean {
  if (typeof token !== 'string') return false
  if (token.length !== TOKEN_TOTAL_LEN) return false
  if (!token.startsWith(TOKEN_PREFIX)) return false
  const randomStart = TOKEN_PREFIX.length
  const randomEnd = randomStart + RANDOM_B64_LEN
  const separator = token[randomEnd]
  if (separator !== '_') return false
  const hmacStart = randomEnd + 1
  const randomPart = token.slice(randomStart, randomEnd)
  const hmacPart = token.slice(hmacStart, hmacStart + HMAC_B64_LEN)
  const random = base64urlDecode(randomPart)
  if (!random || random.length !== RANDOM_BYTES) return false
  const provided = base64urlDecode(hmacPart)
  if (!provided || provided.length !== HMAC_BYTES) return false
  const expected = computeHmacBytes(random)
  try {
    return timingSafeEqual(provided, expected)
  } catch {
    return false
  }
}

/**
 * Build the synthetic RFC 5322 Message-ID we inject into outbound
 * `References:` headers. Uses the IANA-reserved `.invalid` TLD (RFC 6761
 * § 3) so RFC-compliant MTAs MUST accept it as syntactically valid.
 */
export function buildReferencesId(token: string): string {
  return `<${token}@open-mercato.invalid>`
}

/**
 * Build the hidden HTML body span + plain-text trailer used as the
 * token's secondary attachment point (in case `References` is stripped
 * by the recipient's MUA).
 */
export function buildBodyFooter(token: string): { html: string; plain: string } {
  return {
    html: `<span style="display:none">[OM:${token}]</span>`,
    plain: `\n\n[OM:${token}]`,
  }
}

/**
 * Apply the thread token to an outbound MIME-like payload. Mutates the
 * input shape minimally and idempotently:
 *   - `headers.references`: appends the synthetic `<om_TOKEN@…>` id if not
 *     already present (deduped).
 *   - `bodyHtml`: injects a hidden `<span>` before the last `</body>` tag,
 *     or appends if no `</body>` is present.
 *   - `bodyText`: appends the plain-text trailer.
 *
 * Returns a NEW object — does not mutate the input. Callers that maintain
 * their own MIME structure can call the building blocks directly.
 */
export function applyOutboundThreadingToken<
  T extends {
    headers?: Record<string, string | string[] | undefined>
    bodyHtml?: string
    bodyText?: string
  },
>(payload: T, token: string): T {
  if (!verifyToken(token)) {
    throw new Error('applyOutboundThreadingToken: invalid token format/signature')
  }
  const refId = buildReferencesId(token)
  const footer = buildBodyFooter(token)

  const headers = { ...(payload.headers ?? {}) } as Record<string, string | string[] | undefined>
  const existingRefs = headers['references'] ?? headers['References']
  let nextRefs: string
  if (Array.isArray(existingRefs)) {
    nextRefs = existingRefs.includes(refId) ? existingRefs.join(' ') : [...existingRefs, refId].join(' ')
  } else if (typeof existingRefs === 'string' && existingRefs.length > 0) {
    nextRefs = existingRefs.includes(refId) ? existingRefs : `${existingRefs} ${refId}`
  } else {
    nextRefs = refId
  }
  // Normalise to the canonical RFC 5322 header name and drop any duplicate
  // lowercase entry so the MTA sees a single `References` header.
  delete headers['references']
  headers['References'] = nextRefs

  let bodyHtml = payload.bodyHtml
  if (typeof bodyHtml === 'string') {
    if (!bodyHtml.includes(`[OM:${token}]`)) {
      const closing = bodyHtml.lastIndexOf('</body>')
      if (closing >= 0) {
        bodyHtml = `${bodyHtml.slice(0, closing)}${footer.html}${bodyHtml.slice(closing)}`
      } else {
        bodyHtml = `${bodyHtml}${footer.html}`
      }
    }
  }

  let bodyText = payload.bodyText
  if (typeof bodyText === 'string') {
    if (!bodyText.includes(`[OM:${token}]`)) {
      bodyText = `${bodyText}${footer.plain}`
    }
  }

  return {
    ...payload,
    headers,
    ...(bodyHtml !== undefined ? { bodyHtml } : {}),
    ...(bodyText !== undefined ? { bodyText } : {}),
  }
}

/**
 * Extract token candidates from a `References` / `In-Reply-To` header
 * value (string or string[]) and return the FIRST one that HMAC-verifies.
 * Returns `null` if no valid token is present.
 */
export function extractTokenFromHeaders(
  inReplyTo: string | null | undefined,
  references: string[] | string | null | undefined,
): string | null {
  const haystack: string[] = []
  if (typeof inReplyTo === 'string' && inReplyTo.length > 0) haystack.push(inReplyTo)
  if (Array.isArray(references)) haystack.push(...references)
  else if (typeof references === 'string' && references.length > 0) haystack.push(references)
  for (const candidate of haystack) {
    const matches = candidate.match(new RegExp(TOKEN_REGEX, 'g'))
    if (!matches) continue
    for (const match of matches) {
      if (verifyToken(match)) return match
    }
  }
  return null
}

/**
 * Idempotent upsert: return the existing `ChannelThreadToken` for the
 * given thread, or create + return a new one. The unique constraint on
 * `(tenant_id, token)` plus the random distribution of `generateToken()`
 * mean we can safely call this concurrently — a duplicate insertion is
 * astronomically unlikely.
 *
 * Reads via the standard EntityManager (no encryption needed — the token
 * column itself is the HMAC-signed value, not encrypted at rest).
 *
 * Use cases:
 *   - Outbound subscriber: get or create a token before injecting it
 *     into the outbound MIME (`applyOutboundThreadingToken`).
 *   - Future "reset" UI for tenant admins: explicit rotation by deleting
 *     the row + calling this helper again.
 */
export async function getOrCreateThreadToken(
  em: EntityManager,
  args: {
    tenantId: string
    organizationId: string | null
    messageThreadId: string
  },
): Promise<{ token: string; created: boolean }> {
  const existing = await findOneWithDecryption(
    em,
    ChannelThreadToken,
    {
      tenantId: args.tenantId,
      messageThreadId: args.messageThreadId,
    },
    undefined,
    { tenantId: args.tenantId, organizationId: args.organizationId },
  )
  if (existing) {
    return { token: existing.token, created: false }
  }
  const row = em.create(ChannelThreadToken, {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    messageThreadId: args.messageThreadId,
    token: generateToken(),
  })
  // MikroORM v7 removed `persistAndFlush` — split into persist + flush.
  em.persist(row)
  await em.flush()
  return { token: row.token, created: true }
}

/**
 * Extract a token candidate from an inbound body (HTML or plain text).
 * Scans for `[OM:om_…]` markers and returns the first that HMAC-verifies.
 */
export function extractTokenFromBody(
  bodyHtml: string | null | undefined,
  bodyText: string | null | undefined,
): string | null {
  const haystacks = [bodyHtml, bodyText].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  const pattern = new RegExp(`\\[OM:(${TOKEN_REGEX.source})\\]`, 'g')
  for (const haystack of haystacks) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(haystack)) !== null) {
      if (verifyToken(match[1])) return match[1]
    }
  }
  return null
}
