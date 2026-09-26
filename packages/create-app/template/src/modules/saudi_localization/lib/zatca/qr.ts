import { formatSaudDecimal, isValidSaudiVatNumber } from '../saudi/vat'

/**
 * ZATCA (Fatoora) Phase 1 QR payload.
 *
 * Every simplified tax invoice issued in Saudi Arabia must carry a QR code whose
 * content is a TLV (tag-length-value) byte string, Base64-encoded. The five
 * Phase 1 tags are seller name, VAT registration number, the invoice timestamp,
 * the invoice total including VAT, and the VAT total. Phase 2 adds the invoice
 * hash, the cryptographic stamp and the public key as tags 6–9 on top of the very
 * same encoding, which is why the tag list and the encoder are separate here.
 *
 * Encoding rules that matter in practice:
 *   - one byte tag, one byte length, then the UTF-8 bytes of the value — so a
 *     value may hold at most 255 bytes, and an Arabic seller name (2 bytes per
 *     character) is limited to 127 characters;
 *   - the timestamp must be ISO 8601 with an offset, not a date-only string;
 *   - amounts are decimal strings with exactly two decimals and no separators.
 *
 * Pure by design: no clock, no network, no platform APIs beyond `TextEncoder`.
 * The caller decides the timestamp, which keeps the function testable against
 * published vectors and keeps invoice replay deterministic.
 */

export const ZATCA_QR_TAG = {
  sellerName: 1,
  vatRegistrationNumber: 2,
  issuedAt: 3,
  invoiceTotalWithVat: 4,
  vatTotal: 5,
} as const

export type ZatcaQrTagName = keyof typeof ZATCA_QR_TAG

export type ZatcaQrTag = {
  tag: number
  value: string
}

export type ZatcaQrInvoice = {
  /** Registered seller name as it appears on the tax invoice. */
  sellerName: string
  /** 15-digit ZATCA VAT registration number. */
  vatRegistrationNumber: string
  /** Date or ISO 8601 string with an offset; the caller owns "now". */
  issuedAt: Date | string
  /** Invoice total including VAT, e.g. `115`, `'115.00'`, `115.5`. */
  invoiceTotalWithVat: number | string
  /** VAT total, e.g. `15`, `'15.00'`. */
  vatTotal: number | string
}

export type ZatcaQrErrorCode =
  | 'invalid_seller_name'
  | 'invalid_vat_number'
  | 'invalid_timestamp'
  | 'invalid_amount'
  | 'empty_value'
  | 'value_too_long'

export class ZatcaQrError extends Error {
  readonly code: ZatcaQrErrorCode
  readonly tag?: ZatcaQrTagName

  constructor(code: ZatcaQrErrorCode, message: string, tag?: ZatcaQrTagName) {
    super(`[internal] ${message}`)
    this.name = 'ZatcaQrError'
    this.code = code
    this.tag = tag
  }
}

/** ISO 8601 with a time component and an offset (`Z` or `±hh:mm`). */
const ISO_8601_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

const MAX_TLV_VALUE_BYTES = 255

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/**
 * Base64 of raw bytes, implemented here rather than reached for from `Buffer`
 * or `btoa` so the encoder behaves identically in the Node invoice pipeline and
 * in a browser preview.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const firstByte = bytes[index]
    const secondByte = bytes[index + 1]
    const thirdByte = bytes[index + 2]
    const hasSecond = secondByte !== undefined
    const hasThird = thirdByte !== undefined
    const chunk = (firstByte << 16) | ((secondByte ?? 0) << 8) | (thirdByte ?? 0)
    output += BASE64_ALPHABET[(chunk >> 18) & 63]
    output += BASE64_ALPHABET[(chunk >> 12) & 63]
    output += hasSecond ? BASE64_ALPHABET[(chunk >> 6) & 63] : '='
    output += hasThird ? BASE64_ALPHABET[chunk & 63] : '='
  }
  return output
}

function normalizeTimestamp(issuedAt: Date | string): string {
  if (issuedAt instanceof Date) {
    if (Number.isNaN(issuedAt.getTime())) {
      throw new ZatcaQrError('invalid_timestamp', 'The invoice timestamp is not a valid date.', 'issuedAt')
    }
    return issuedAt.toISOString()
  }
  if (!ISO_8601_WITH_OFFSET.test(issuedAt)) {
    throw new ZatcaQrError(
      'invalid_timestamp',
      'The invoice timestamp must be ISO 8601 with an offset, for example 2026-01-31T09:15:00Z.',
      'issuedAt',
    )
  }
  return issuedAt
}

function requireAmount(value: number | string, tag: ZatcaQrTagName): string {
  try {
    return formatSaudDecimal(value)
  } catch {
    throw new ZatcaQrError('invalid_amount', `The ${tag} amount must be a non-negative decimal number.`, tag)
  }
}

/**
 * The five Phase 1 tags in the order ZATCA expects. Exposed separately from the
 * payload builder so Phase 2 tags can be appended without touching Phase 1
 * semantics, and so a caller can render the values next to the QR code.
 */
export function buildZatcaQrTags(invoice: ZatcaQrInvoice): readonly ZatcaQrTag[] {
  const sellerName = invoice.sellerName.trim()
  if (!sellerName) {
    throw new ZatcaQrError('invalid_seller_name', 'The seller name is required for a ZATCA QR code.', 'sellerName')
  }
  if (!isValidSaudiVatNumber(invoice.vatRegistrationNumber)) {
    throw new ZatcaQrError(
      'invalid_vat_number',
      'The VAT registration number must be 15 digits, starting and ending with 3.',
      'vatRegistrationNumber',
    )
  }

  return [
    { tag: ZATCA_QR_TAG.sellerName, value: sellerName },
    { tag: ZATCA_QR_TAG.vatRegistrationNumber, value: invoice.vatRegistrationNumber.trim() },
    { tag: ZATCA_QR_TAG.issuedAt, value: normalizeTimestamp(invoice.issuedAt) },
    { tag: ZATCA_QR_TAG.invoiceTotalWithVat, value: requireAmount(invoice.invoiceTotalWithVat, 'invoiceTotalWithVat') },
    { tag: ZATCA_QR_TAG.vatTotal, value: requireAmount(invoice.vatTotal, 'vatTotal') },
  ]
}

/** TLV bytes: one byte tag, one byte UTF-8 byte length, then the value bytes. */
export function encodeZatcaQrTlv(tags: readonly ZatcaQrTag[]): Uint8Array {
  const chunks: Uint8Array[] = []

  for (const { tag, value } of tags) {
    if (!Number.isInteger(tag) || tag < 1 || tag > 255) {
      throw new ZatcaQrError('empty_value', `The tag id ${tag} must be an integer between 1 and 255.`)
    }
    const valueBytes = encodeUtf8(value)
    if (valueBytes.length === 0) {
      throw new ZatcaQrError('empty_value', 'A ZATCA QR tag cannot carry an empty value.')
    }
    if (valueBytes.length > MAX_TLV_VALUE_BYTES) {
      throw new ZatcaQrError(
        'value_too_long',
        `The ${valueBytes.length}-byte value exceeds the 255-byte TLV limit (an Arabic seller name is limited to 127 characters).`,
      )
    }
    chunks.push(new Uint8Array([tag, valueBytes.length]), valueBytes)
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }
  return buffer
}

/** The string that goes into the invoice's QR code. */
export function buildZatcaQrPayload(invoice: ZatcaQrInvoice): string {
  return encodeBase64(encodeZatcaQrTlv(buildZatcaQrTags(invoice)))
}
