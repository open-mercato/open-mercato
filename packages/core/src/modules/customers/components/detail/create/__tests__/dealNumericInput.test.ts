import { sanitizeAmount, sanitizeProbability } from '../dealNumericInput'

describe('sanitizeAmount', () => {
  it('strips non-numeric characters', () => {
    expect(sanitizeAmount('12abc')).toBe('12')
    expect(sanitizeAmount('a1b2c3')).toBe('123')
  })
  it('keeps a single decimal point and drops extra dots', () => {
    expect(sanitizeAmount('12.5')).toBe('12.5')
    expect(sanitizeAmount('1.2.3')).toBe('1.23')
  })
  it('strips the minus sign so amounts cannot go negative', () => {
    expect(sanitizeAmount('-5')).toBe('5')
  })
  it('allows an empty value', () => {
    expect(sanitizeAmount('')).toBe('')
  })

  it.each(['pl', 'de', 'es'])('reads a comma as the decimal separator in %s', (locale) => {
    expect(sanitizeAmount('12,50', locale)).toBe('12.50')
    expect(sanitizeAmount('12,', locale)).toBe('12.')
  })

  it('still accepts a decimal point in a comma locale', () => {
    expect(sanitizeAmount('12.50', 'pl')).toBe('12.50')
  })

  it('drops grouping from a pasted amount in a comma locale', () => {
    expect(sanitizeAmount('1\u00a0250,50', 'pl')).toBe('1250.50')
    expect(sanitizeAmount('1.250,50', 'de')).toBe('1250.50')
    expect(sanitizeAmount('1.234.567,8', 'de')).toBe('1234567.8')
  })

  it('does not turn a decimal into a larger amount when a stray comma follows it', () => {
    expect(sanitizeAmount('12.50,', 'pl')).toBe('12.50')
    expect(sanitizeAmount('1,5,5', 'pl')).toBe('1.55')
  })

  it.each(['en', 'ko', undefined])('keeps the comma as grouping in %s', (locale) => {
    expect(sanitizeAmount('1,250', locale)).toBe('1250')
    expect(sanitizeAmount('1,250.50', locale)).toBe('1250.50')
  })
})

describe('sanitizeProbability', () => {
  it('keeps digits only', () => {
    expect(sanitizeProbability('5a0')).toBe('50')
    expect(sanitizeProbability('2.5')).toBe('25')
  })
  it('clamps values above 100', () => {
    expect(sanitizeProbability('150')).toBe('100')
    expect(sanitizeProbability('9999')).toBe('100')
  })
  it('accepts the full 0–100 range', () => {
    expect(sanitizeProbability('0')).toBe('0')
    expect(sanitizeProbability('25')).toBe('25')
    expect(sanitizeProbability('100')).toBe('100')
  })
  it('returns empty for no digits', () => {
    expect(sanitizeProbability('')).toBe('')
    expect(sanitizeProbability('abc')).toBe('')
  })
})
