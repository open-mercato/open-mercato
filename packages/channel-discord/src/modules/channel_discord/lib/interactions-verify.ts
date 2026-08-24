import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

/**
 * Discord interaction request signing (Ed25519).
 *
 * Every interaction POST carries `X-Signature-Ed25519` (hex) and
 * `X-Signature-Timestamp`. The signed payload is `timestamp + rawBody`, verified
 * against the application's Ed25519 **public key** (hex, from the General
 * Information tab). We verify with Node's built-in `crypto` (`ed25519`) — no
 * `tweetnacl` dependency.
 *
 * SECURITY CONTRACT: this function is FAIL-CLOSED. It returns `false` on a
 * missing header, a malformed key/signature, or any verification error — never
 * throws, never returns `true` on doubt. Callers MUST reject (`401`) on `false`.
 */

// Standard SPKI DER prefix for an Ed25519 public key (RFC 8410). Prepending it
// to the 32 raw key bytes yields a DER document `createPublicKey` accepts,
// avoiding a third-party crypto dependency.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value)
}

/** An Ed25519 signature is 64 bytes, so 128 hex characters. */
const ED25519_SIGNATURE_HEX_LENGTH = 128

/**
 * Whether the request's signature headers are even capable of verifying —
 * present, hex, and the right length. This depends on the REQUEST ALONE, never
 * on a candidate channel, which is why it is exported separately: the route runs
 * it before it loads any channel, so an unsigned or malformed POST is rejected
 * without a single database round-trip.
 *
 * `verifyDiscordSignature` applies the same guard itself, so this is an
 * optimisation of *when* the answer is known, never a replacement for the
 * fail-closed check.
 */
export function hasVerifiableSignatureHeaders(
  signatureHex: string | undefined | null,
  timestamp: string | undefined | null,
): signatureHex is string {
  if (!signatureHex || !timestamp) return false
  return isHex(signatureHex) && signatureHex.length === ED25519_SIGNATURE_HEX_LENGTH
}

function publicKeyFromHex(publicKeyHex: string) {
  if (!isHex(publicKeyHex) || publicKeyHex.length !== 64) {
    throw new Error('invalid ed25519 public key')
  }
  const raw = Buffer.from(publicKeyHex, 'hex')
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

export interface VerifyDiscordSignatureInput {
  publicKeyHex: string
  signatureHex: string | undefined | null
  timestamp: string | undefined | null
  rawBody: string
}

/**
 * Verify a Discord interaction signature. Returns `true` only when the signature
 * cryptographically matches `timestamp + rawBody` under `publicKeyHex`.
 */
export function verifyDiscordSignature(input: VerifyDiscordSignatureInput): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = input
  if (!hasVerifiableSignatureHeaders(signatureHex, timestamp)) return false
  try {
    const key = publicKeyFromHex(publicKeyHex)
    const message = Buffer.from(String(timestamp) + rawBody, 'utf-8')
    const signature = Buffer.from(signatureHex, 'hex')
    // Ed25519: the algorithm is implied by the key, so the first arg is null.
    return cryptoVerify(null, message, key, signature)
  } catch {
    return false
  }
}

/**
 * Replay guard. Discord signs `timestamp + body`, but a captured request stays
 * cryptographically valid forever — freshness has to be enforced separately.
 * A timestamp outside the ± skew window (or missing / non-numeric) is rejected,
 * fail-closed, so a recorded interaction cannot be replayed later.
 */
export const DISCORD_SIGNATURE_MAX_SKEW_SECONDS = 300

export interface TimestampFreshnessOptions {
  maxSkewSeconds?: number
  /** Injectable clock (epoch seconds) for tests; defaults to the real clock. */
  nowEpochSeconds?: number
}

export function isSignatureTimestampFresh(
  timestamp: string | undefined | null,
  options?: TimestampFreshnessOptions,
): boolean {
  if (!timestamp) return false
  const value = String(timestamp).trim()
  if (!/^\d{1,12}$/.test(value)) return false
  const parsedSeconds = Number(value)
  if (!Number.isSafeInteger(parsedSeconds)) return false
  const maxSkewSeconds = options?.maxSkewSeconds ?? DISCORD_SIGNATURE_MAX_SKEW_SECONDS
  const nowSeconds = options?.nowEpochSeconds ?? Math.floor(Date.now() / 1000)
  return Math.abs(nowSeconds - parsedSeconds) <= maxSkewSeconds
}

/** Discord interaction types. */
export const DiscordInteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const

/** Discord interaction response types. */
export const DiscordInteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
} as const

export interface ParsedInteraction {
  type: number
  data?: Record<string, unknown>
  member?: { user?: { id?: string; username?: string; global_name?: string | null } }
  user?: { id?: string; username?: string; global_name?: string | null }
  channel_id?: string
  guild_id?: string
  application_id?: string
  id?: string
  token?: string
  [key: string]: unknown
}

/**
 * Parse the interaction body. Returns `null` when the body is not a JSON object
 * with a numeric `type` — the caller treats that as a non-interaction payload.
 */
export function parseInteractionBody(rawBody: string): ParsedInteraction | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as { type?: unknown }
    if (typeof candidate.type !== 'number') return null
    return parsed as ParsedInteraction
  } catch {
    return null
  }
}

/**
 * The `application_id` an interaction body claims, or `null` when the body does
 * not carry a usable one.
 *
 * UNTRUSTED — this value is read before any signature has been verified, so it
 * may only ever be used to NARROW the set of candidate channels the signature is
 * then checked against. It is never an authorization decision: a body claiming
 * another tenant's application still has to carry that tenant's Ed25519
 * signature to be accepted, and a body claiming nothing falls back to the full
 * candidate set rather than being let through.
 */
export function readInteractionApplicationId(rawBody: string): string | null {
  const interaction = parseInteractionBody(rawBody)
  const applicationId = interaction?.application_id
  return typeof applicationId === 'string' && applicationId.length > 0 ? applicationId : null
}
