import { compareScaledAmounts, formatScaledAmount, toScaledAmount } from '../priceAmounts'

describe('sales line price amounts', () => {
  it.each([
    ['19.9900', BigInt(199900)],
    ['19.99', BigInt(199900)],
    [19.99, BigInt(199900)],
    ['  17.5 ', BigInt(175000)],
    ['10', BigInt(100000)],
    ['.5', BigInt(5000)],
    ['-3.25', BigInt(-32500)],
    ['0.00004', BigInt(0)],
    ['-0.00004', BigInt(0)],
    ['1.00005', BigInt(10001)],
    ['1.000049999', BigInt(10000)],
    [0.1 + 0.2, BigInt(3000)],
  ])('scales %p to 10^-4 units', (input, expected) => {
    expect(toScaledAmount(input)).toBe(expected)
  })

  it.each([null, undefined, '', 'abc', '1e3', '1.2.3', '.', Number.NaN, Number.POSITIVE_INFINITY, {}])(
    'rejects %p',
    (input) => {
      expect(toScaledAmount(input)).toBeNull()
    },
  )

  it('treats amounts that differ only in scale or float noise as equal', () => {
    const stored = toScaledAmount('19.9900')
    const snapshot = toScaledAmount(19.99)
    if (stored === null || snapshot === null) throw new Error('[internal] amounts should parse')
    expect(compareScaledAmounts(stored, snapshot)).toBe(0)
    expect(compareScaledAmounts(BigInt(1), BigInt(2))).toBe(-1)
    expect(compareScaledAmounts(BigInt(2), BigInt(1))).toBe(1)
  })

  it.each([
    [BigInt(199900), '19.99'],
    [BigInt(175000), '17.50'],
    [BigInt(100000), '10.00'],
    [BigInt(1250), '0.125'],
    [BigInt(5), '0.0005'],
    [BigInt(0), '0.00'],
    [BigInt(-32500), '-3.25'],
  ])('formats %p as %p', (units, expected) => {
    expect(formatScaledAmount(units)).toBe(expected)
  })
})
