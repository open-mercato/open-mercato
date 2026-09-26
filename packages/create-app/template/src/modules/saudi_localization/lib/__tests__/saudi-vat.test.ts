import {
  SAUDI_STANDARD_VAT_RATE,
  computeVatFromNet,
  formatSaudDecimal,
  isValidSaudiVatNumber,
  roundToHalalas,
} from '../saudi/vat'

describe('isValidSaudiVatNumber', () => {
  it('accepts a 15-digit number that starts and ends with 3', () => {
    expect(isValidSaudiVatNumber('300000000000003')).toBe(true)
    expect(isValidSaudiVatNumber('311111111111113')).toBe(true)
  })

  it('rejects wrong lengths, wrong edges and formatted input', () => {
    expect(isValidSaudiVatNumber('30000000000003')).toBe(false)
    expect(isValidSaudiVatNumber('3000000000000003')).toBe(false)
    expect(isValidSaudiVatNumber('400000000000003')).toBe(false)
    expect(isValidSaudiVatNumber('300000000000004')).toBe(false)
    expect(isValidSaudiVatNumber('300-000-000-000-003')).toBe(false)
    expect(isValidSaudiVatNumber(' 300000000000003')).toBe(false)
    expect(isValidSaudiVatNumber('')).toBe(false)
  })
})

describe('roundToHalalas', () => {
  it('rounds the decimal the caller wrote, not its binary approximation', () => {
    expect(roundToHalalas(1.005)).toBe(1.01)
    expect(roundToHalalas(2.675)).toBe(2.68)
    expect(roundToHalalas(115.005)).toBe(115.01)
  })

  it('rounds below the halala down and at the boundary up', () => {
    expect(roundToHalalas(0.004)).toBe(0)
    expect(roundToHalalas(114.999)).toBe(115)
    expect(roundToHalalas(0)).toBe(0)
  })

  it('refuses non-finite and out-of-range amounts', () => {
    expect(() => roundToHalalas(Number.NaN)).toThrow('[internal]')
    expect(() => roundToHalalas(Number.POSITIVE_INFINITY)).toThrow('[internal]')
    expect(() => roundToHalalas(1e15)).toThrow('[internal]')
  })
})

describe('formatSaudDecimal', () => {
  it('normalizes numbers and plain decimal strings to two decimals', () => {
    expect(formatSaudDecimal(115)).toBe('115.00')
    expect(formatSaudDecimal('115.5')).toBe('115.50')
    expect(formatSaudDecimal('0.05')).toBe('0.05')
    expect(formatSaudDecimal(0)).toBe('0.00')
  })

  it('rounds half up at the halala', () => {
    expect(formatSaudDecimal(1.005)).toBe('1.01')
    expect(formatSaudDecimal('115.005')).toBe('115.01')
  })

  it('never emits a grouped or comma-decimal value', () => {
    expect(formatSaudDecimal(1234567.891)).toBe('1234567.89')
  })

  it('refuses anything that is not a plain non-negative decimal', () => {
    const invalidValues: Array<number | string> = ['-1', 'abc', '1e3', '1,000.00', '', '   ', '1.2.3', Number.NaN, Number.POSITIVE_INFINITY, -0.5]
    for (const invalid of invalidValues) {
      expect(() => formatSaudDecimal(invalid)).toThrow('[internal]')
    }
  })
})

describe('computeVatFromNet', () => {
  it('applies the 15% standard rate', () => {
    expect(computeVatFromNet(100)).toEqual({ net: 100, vat: 15, gross: 115, rate: SAUDI_STANDARD_VAT_RATE })
    expect(SAUDI_STANDARD_VAT_RATE).toBe(0.15)
  })

  it('keeps net + VAT equal to the gross after halala rounding', () => {
    const breakdown = computeVatFromNet(99.99)

    expect(breakdown.net).toBe(99.99)
    expect(breakdown.vat).toBe(15)
    expect(breakdown.gross).toBe(114.99)
    expect(roundToHalalas(breakdown.net + breakdown.vat)).toBe(breakdown.gross)
  })

  it('rounds a sub-halala VAT up', () => {
    expect(computeVatFromNet(0.05)).toEqual({ net: 0.05, vat: 0.01, gross: 0.06, rate: 0.15 })
  })

  it('accepts a historical rate', () => {
    expect(computeVatFromNet(200, 0.05)).toEqual({ net: 200, vat: 10, gross: 210, rate: 0.05 })
  })

  it('rejects negative amounts and rates', () => {
    expect(() => computeVatFromNet(-1)).toThrow('[internal]')
    expect(() => computeVatFromNet(10, -0.15)).toThrow('[internal]')
    expect(() => computeVatFromNet(10, Number.NaN)).toThrow('[internal]')
  })
})
