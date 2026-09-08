import { formatQuantity, parseQuantity, quantityInputValue } from '../lib/quantity'

describe('parseQuantity', () => {
  it('parses numeric strings with trailing zeros', () => {
    expect(parseQuantity('1.0000')).toBe(1)
    expect(parseQuantity('2.5000')).toBe(2.5)
    expect(parseQuantity('0.2500')).toBe(0.25)
  })

  it('passes numbers through', () => {
    expect(parseQuantity(3)).toBe(3)
    expect(parseQuantity(0)).toBe(0)
  })

  it('returns null for empty and invalid input', () => {
    expect(parseQuantity(null)).toBeNull()
    expect(parseQuantity(undefined)).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('   ')).toBeNull()
    expect(parseQuantity('abc')).toBeNull()
    expect(parseQuantity(Number.NaN)).toBeNull()
  })
})

describe('formatQuantity', () => {
  it('trims trailing zeros from stored numeric strings', () => {
    expect(formatQuantity('1.0000', '—')).toBe('1')
    expect(formatQuantity('2.5000', '—')).toBe('2.5')
  })

  it('keeps meaningful decimals up to four places', () => {
    expect(formatQuantity('0.1250', '—')).toBe('0.125')
  })

  it('returns the fallback for missing values', () => {
    expect(formatQuantity(null, '—')).toBe('—')
    expect(formatQuantity('', '—')).toBe('—')
  })
})

describe('quantityInputValue', () => {
  it('produces a plain dot-decimal string for input seeding', () => {
    expect(quantityInputValue('1.0000')).toBe('1')
    expect(quantityInputValue('2.5000')).toBe('2.5')
  })

  it('produces an empty string for missing values', () => {
    expect(quantityInputValue(null)).toBe('')
    expect(quantityInputValue(undefined)).toBe('')
  })
})
