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
