import { createHash } from 'node:crypto'
import { encodeBase64 } from './qr'

/**
 * ZATCA invoice hashing.
 *
 * The single detail that breaks integrations quietly: ZATCA represents an invoice
 * hash as the **Base64 of the SHA-256 hex digest** — the 64-character hexadecimal
 * string is what gets Base64-encoded, not the 32 raw digest bytes. Both forms are
 * valid Base64 and both are 44 or 88 characters long enough to look right, so a
 * mismatch only shows up when ZATCA rejects the document.
 *
 * The published constant for the first invoice in a chain is the proof: it equals
 * `base64(hex(sha256("0")))`, and `deriveInitialPreviousInvoiceHash()` recomputes
 * it here so the value can never be hand-typed wrongly.
 *
 * Hashes are compared as strings everywhere, which is why validation is a shape
 * check: 64 lowercase hex characters in, 88 Base64 characters out.
 */

export const ZATCA_HASH_HEX_LENGTH = 64
export const ZATCA_HASH_BASE64_LENGTH = 88

const HEX_DIGEST = /^[0-9a-f]{64}$/

/**
 * `base64(hex(sha256("0")))` — the `PIH` a first invoice must carry, per the
 * published ZATCA value (`NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==`).
 * Derived at load time rather than typed out, so the value cannot drift.
 */
export const INITIAL_PREVIOUS_INVOICE_HASH = deriveInitialPreviousInvoiceHash()

export type ZatcaHashErrorCode = 'invalid_digest' | 'invalid_hash'

export class ZatcaHashError extends Error {
  readonly code: ZatcaHashErrorCode

  constructor(code: ZatcaHashErrorCode, message: string) {
    super(`[internal] ${message}`)
    this.name = 'ZatcaHashError'
    this.code = code
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * The Base64 form ZATCA uses for invoice hashes: the hex digest, encoded as text.
 */
export function toZatcaInvoiceHash(hexDigest: string): string {
  if (!HEX_DIGEST.test(hexDigest)) {
    throw new ZatcaHashError('invalid_digest', 'An invoice hash must come from a lowercase 64-character SHA-256 hex digest.')
  }
  return encodeBase64(new TextEncoder().encode(hexDigest))
}

/**
 * The hash of the document as it exists *before* the QR code and the signature are
 * inserted — see `buildZatcaInvoicePreHashXml`.
 */
export function computeInvoiceHash(preHashXml: string): string {
  return toZatcaInvoiceHash(sha256Hex(preHashXml))
}

export function deriveInitialPreviousInvoiceHash(): string {
  return computeInvoiceHash('0')
}

export function isZatcaInvoiceHash(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length === ZATCA_HASH_BASE64_LENGTH &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

/**
 * The `PIH` to embed: the previous invoice's hash, or the chain-start constant when
 * nothing has been issued in this scope yet. A malformed stored value throws rather
 * than being silently replaced, because replacing it would break the chain.
 */
export function resolvePreviousInvoiceHash(lastInvoiceHash: string | null | undefined): string {
  const trimmed = typeof lastInvoiceHash === 'string' ? lastInvoiceHash.trim() : ''
  if (!trimmed) return INITIAL_PREVIOUS_INVOICE_HASH
  if (!isZatcaInvoiceHash(trimmed)) {
    throw new ZatcaHashError('invalid_hash', 'The stored previous invoice hash is not a Base64 invoice hash.')
  }
  return trimmed
}
