/** @jest-environment node */
/**
 * Pins the halala arithmetic the freight ledger and the sales bridge rely on.
 *
 * The contract is: every amount round-trips through the Saudi primitives
 * unchanged, sums are exact (integer halalas, never float accumulation), and the
 * half-halala tie resolves upward on the decimal as written — `10.05 × 15%`
 * must be `1.51`, not `1.50`.
 */
import {
  amountToString,
  computeLineEnvelope,
  computeQuantityAmount,
  halalasToAmountString,
  percentToFraction,
  sumEnvelopes,
  toAmountNumber,
  toHalalas,
} from '../money'

describe('money helpers', () => {
  it('parses stored numeric strings and rejects nothing into NaN', () => {
    expect(toAmountNumber('115.0000')).toBe(115)
    expect(toAmountNumber(0.5)).toBe(0.5)
    expect(toAmountNumber(null)).toBe(0)
    expect(toAmountNumber(undefined)).toBe(0)
    expect(toAmountNumber('not-a-number')).toBe(0)
  })

  it('treats the VAT rate as a fraction-of-percent boundary', () => {
    expect(percentToFraction('15')).toBeCloseTo(0.15, 10)
    expect(percentToFraction(5)).toBeCloseTo(0.05, 10)
  })

  it('computes a VAT envelope with the standard rate and rounds the tie upward', () => {
    const envelope = computeLineEnvelope('10.05', '15')
    expect(envelope).toEqual({ net: 10.05, tax: 1.51, gross: 11.56 })
  })

  it('keeps the gross equal to net + tax for every computed line', () => {
    for (const net of ['0.01', '0.10', '1.005', '99.99', '123456.789']) {
      const envelope = computeLineEnvelope(net, '15')
      expect(toHalalas(envelope.gross)).toBe(toHalalas(envelope.net) + toHalalas(envelope.tax))
    }
  })

  it('sums envelopes exactly in integer halalas', () => {
    const total = sumEnvelopes([
      computeLineEnvelope('0.10', '15'),
      computeLineEnvelope('0.20', '15'),
    ])
    expect(amountToString(total.net)).toBe('0.30')
    expect(toHalalas(total.gross)).toBe(toHalalas(total.net) + toHalalas(total.tax))
  })

  it('quantities multiply at halala precision', () => {
    expect(computeQuantityAmount('12.5', '100.80')).toBe(1260)
    expect(computeQuantityAmount('3', '100.005')).toBe(300.02)
  })

  it('formats amounts and halalas back into plain decimals', () => {
    expect(amountToString(115)).toBe('115.00')
    expect(halalasToAmountString(151)).toBe('1.51')
    expect(halalasToAmountString(-151)).toBe('-1.51')
  })
})
