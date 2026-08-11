import { formatCurrency, formatDate } from '../format'

// Every assertion below pins the locale explicitly (#5105). Without it these tests read the
// runtime's default locale, so they pass in en-US and fail on any contributor machine whose
// default is something else.
const EN = 'en-US'
const PL = 'pl-PL'

// Midday UTC keeps the calendar month stable in every real timezone, so the month token can be
// asserted without the suite depending on the runner's TZ.
const MIDDAY_UTC = '2026-06-09T12:00:00.000Z'

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
    expect(formatCurrency(1234.5, 'usd', EN)).toBe('$1,234.50')
  })

  it('formats a numeric string the same as a number', () => {
    expect(formatCurrency('1234.5', 'USD', EN)).toBe(formatCurrency(1234.5, 'USD', EN))
  })

  it('falls back to a plain number without a currency code', () => {
    expect(formatCurrency(1000, null, EN)).toBe('1,000')
  })

  it('ignores currency codes that are not three characters', () => {
    expect(formatCurrency(1000, 'US', EN)).toBe('1,000')
  })

  it('formats in the requested locale rather than the runtime default', () => {
    expect(formatCurrency(1234.5, 'USD', PL)).toMatch(/^1234,50/)
    expect(formatCurrency(1234.5, 'USD', PL)).toMatch(/USD/)
    expect(formatCurrency(1000, null, PL)).toBe('1000')
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
    expect(formatDate(MIDDAY_UTC, EN)).toMatch(/^Jun \d{1,2}, 2026$/)
  })

  it('formats in the requested locale rather than the runtime default', () => {
    expect(formatDate(MIDDAY_UTC, PL)).toMatch(/^\d{1,2} cze 2026$/)
  })
})
