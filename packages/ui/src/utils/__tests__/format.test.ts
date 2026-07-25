import { formatCurrency, formatDate } from '../format'

describe('formatCurrency', () => {
  it('returns null for empty input', () => {
    expect(formatCurrency(null)).toBeNull()
    expect(formatCurrency(undefined)).toBeNull()
    expect(formatCurrency('')).toBeNull()
  })

  it('echoes back a non-numeric string', () => {
    expect(formatCurrency('n/a')).toBe('n/a')
  })

  it('returns null for a non-finite number', () => {
    expect(formatCurrency(Number.NaN)).toBeNull()
  })

  it('formats a numeric value with an ISO currency code', () => {
    const result = formatCurrency(1234.5, 'usd')
    expect(result).toMatch(/1,234\.5/)
    expect(result).toMatch(/\$|USD/)
  })

  it('formats a numeric string the same as a number', () => {
    expect(formatCurrency('1234.5', 'USD')).toBe(formatCurrency(1234.5, 'USD'))
  })

  it('falls back to a plain number without a currency code', () => {
    expect(formatCurrency(1000)).toBe(new Intl.NumberFormat().format(1000))
  })

  it('ignores currency codes that are not three characters', () => {
    expect(formatCurrency(1000, 'US')).toBe(new Intl.NumberFormat().format(1000))
  })
})

describe('formatDate', () => {
  it('returns null for empty input', () => {
    expect(formatDate(null)).toBeNull()
    expect(formatDate(undefined)).toBeNull()
    expect(formatDate('')).toBeNull()
  })

  it('echoes back an unparseable date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })

  it('formats a valid ISO date as a localized short date', () => {
    const result = formatDate('2026-06-09T00:00:00.000Z')
    expect(result).toEqual(
      new Date('2026-06-09T00:00:00.000Z').toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    )
  })
})
