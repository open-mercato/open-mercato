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
  if (!signatureHex || !timestamp) return false
  if (!isHex(signatureHex) || signatureHex.length !== 128) return false
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
