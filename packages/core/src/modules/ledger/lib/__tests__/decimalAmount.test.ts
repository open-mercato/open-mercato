import {
  formatAmountOrBlank,
  formatAmountUnits,
  parseAmountUnits,
  sumAmountUnits,
} from '../decimalAmount'

describe('parseAmountUnits', () => {
  it('reads numeric(19,4) strings exactly', () => {
    expect(parseAmountUnits('0')).toBe(BigInt(0))
    expect(parseAmountUnits('0.0001')).toBe(BigInt(1))
    expect(parseAmountUnits('12.5')).toBe(BigInt(125000))
    expect(parseAmountUnits('-12.5000')).toBe(BigInt(-125000))
  })

  it('keeps digits beyond the 2^53 limit of a JS number', () => {
    // 999 999 999 999 999.9999 is the largest value a numeric(19,4) holds.
    expect(parseAmountUnits('999999999999999.9999')).toBe(BigInt('9999999999999999999'))
    expect(Number('999999999999999.9999') * 10_000).not.toBe(9999999999999999999)
  })

  it('counts anything that is not a plain decimal as zero', () => {
    expect(parseAmountUnits('')).toBe(BigInt(0))
    expect(parseAmountUnits(null)).toBe(BigInt(0))
    expect(parseAmountUnits('NaN')).toBe(BigInt(0))
    expect(parseAmountUnits('1e3')).toBe(BigInt(0))
  })
})

describe('sumAmountUnits', () => {
  it('sums without float drift', () => {
    expect(sumAmountUnits(['0.1', '0.2'])).toBe(BigInt(3000))
    expect(sumAmountUnits(['999999999999999.9999', '0.0001'])).toBe(BigInt('10000000000000000000'))
  })
})

describe('formatAmountUnits', () => {
  it('shows two to four decimals', () => {
    expect(formatAmountUnits(BigInt(125000), 'en-US')).toBe('12.50')
    expect(formatAmountUnits(BigInt(125001), 'en-US')).toBe('12.5001')
    expect(formatAmountUnits(BigInt(1), 'en-US')).toBe('0.0001')
    expect(formatAmountUnits(BigInt(-125000), 'en-US')).toBe('-12.50')
  })

  it('does not lose the last digits of a large amount', () => {
    expect(formatAmountUnits(BigInt('9999999999999999999'), 'en-US')).toBe('999,999,999,999,999.9999')
  })

  it('follows the locale for grouping and the decimal separator', () => {
    expect(formatAmountUnits(BigInt(12345678900), 'de-DE')).toBe('1.234.567,89')
    expect(formatAmountUnits(BigInt(12345678900), 'en-US')).toBe('1,234,567.89')
  })
})

describe('formatAmountOrBlank', () => {
  it('leaves a zero amount blank', () => {
    expect(formatAmountOrBlank('0.0000', 'en-US')).toBe('')
    expect(formatAmountOrBlank('100', 'en-US')).toBe('100.00')
  })
})
