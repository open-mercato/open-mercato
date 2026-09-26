import {
  INITIAL_PREVIOUS_INVOICE_HASH,
  ZATCA_HASH_BASE64_LENGTH,
  ZatcaHashError,
  computeInvoiceHash,
  deriveInitialPreviousInvoiceHash,
  isZatcaInvoiceHash,
  resolvePreviousInvoiceHash,
  sha256Hex,
  toZatcaInvoiceHash,
} from '../hash'

/** The value ZATCA publishes as the `PIH` of a first invoice. */
const PUBLISHED_INITIAL_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

describe('ZATCA invoice hashing', () => {
  it('derives the published first-invoice hash from the string "0"', () => {
    expect(deriveInitialPreviousInvoiceHash()).toBe(PUBLISHED_INITIAL_PIH)
    expect(INITIAL_PREVIOUS_INVOICE_HASH).toBe(PUBLISHED_INITIAL_PIH)
  })

  it('hashes the hex digest as text, not the raw digest bytes', () => {
    // base64 of the raw 32 bytes is a different string of the same length —
    // picking the wrong one is invisible until ZATCA rejects the invoice.
    const hash = computeInvoiceHash('0')
    const base64OfRawDigest = Buffer.from(sha256Hex('0'), 'hex').toString('base64')

    expect(hash).toBe(PUBLISHED_INITIAL_PIH)
    expect(hash).not.toBe(base64OfRawDigest)
    expect(hash).toHaveLength(ZATCA_HASH_BASE64_LENGTH)
    expect(base64OfRawDigest).toHaveLength(44)
  })

  it('is stable: the same document always produces the same hash', () => {
    expect(computeInvoiceHash('<Invoice>x</Invoice>')).toBe(computeInvoiceHash('<Invoice>x</Invoice>'))
  })

  it('changes when the document changes by a single character', () => {
    expect(computeInvoiceHash('<Invoice>x</Invoice>')).not.toBe(computeInvoiceHash('<Invoice>y</Invoice>'))
  })

  it('rejects digests that are not lowercase 64-character hex', () => {
    expect(() => toZatcaInvoiceHash('abc')).toThrow(ZatcaHashError)
    expect(() => toZatcaInvoiceHash(sha256Hex('0').toUpperCase())).toThrow(ZatcaHashError)
  })

  it('recognizes its own hashes and rejects look-alikes', () => {
    expect(isZatcaInvoiceHash(computeInvoiceHash('0'))).toBe(true)
    expect(isZatcaInvoiceHash('')).toBe(false)
    expect(isZatcaInvoiceHash(null)).toBe(false)
    expect(isZatcaInvoiceHash(PUBLISHED_INITIAL_PIH.slice(0, -1))).toBe(false)
    expect(isZatcaInvoiceHash('*'.repeat(88))).toBe(false)
  })

  it('resolves an empty stored hash to the chain-start constant', () => {
    expect(resolvePreviousInvoiceHash(null)).toBe(PUBLISHED_INITIAL_PIH)
    expect(resolvePreviousInvoiceHash(undefined)).toBe(PUBLISHED_INITIAL_PIH)
    expect(resolvePreviousInvoiceHash('   ')).toBe(PUBLISHED_INITIAL_PIH)
  })

  it('returns a stored hash as-is and refuses a malformed one instead of resetting the chain', () => {
    const stored = computeInvoiceHash('<Invoice>previous</Invoice>')

    expect(resolvePreviousInvoiceHash(stored)).toBe(stored)
    expect(() => resolvePreviousInvoiceHash('not-a-hash')).toThrow(ZatcaHashError)
  })
})
