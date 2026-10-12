import { formatCurrency, formatDate } from '../format'

// Every assertion below pins the locale explicitly (#5105). Without it these tests read the
// runtime's default locale, so they pass in en-US and fail on any contributor machine whose
// default is something else.
const EN = 'en-US'
const PL = 'pl-PL'

// A date-time literal without an offset is parsed as *local* time, so it lands on the same
// calendar day in every timezone and both the month and the day can be asserted exactly. The
// instant form cannot: midday UTC keeps the month stable but still shifts the day at the
// extremes (UTC+14 / UTC-12), which is why the assertions below no longer use one.
const LOCAL_MIDDAY = '2026-06-09T12:00:00'

describe('formatCurrency', () => {
  it('formats decimal strings exactly with the currency precision', () => {
    expect(formatCurrency('0.000000000000000001', 'ETH', 'en-US', 18)?.replace(/\s/g, ' ')).toBe('ETH 0.000000000000000001')
    expect(formatCurrency('12345678901234567890.12', 'USD', 'en-US')).toBe('$12,345,678,901,234,567,890.12')
  })

  it('rounds to the iso digits of a known currency', () => {
    expect(formatCurrency('8.1301', 'USD', EN)).toBe('$8.13')
    expect(formatCurrency('12.3456', 'USD', EN)).toBe('$12.35')
    expect(formatCurrency('5.1234', 'KWD', EN)?.replace(/\s/g, ' ')).toBe('KWD 5.123')
    expect(formatCurrency('1234.5', 'JPY', EN)).toBe('¥1,235')
  })

  it('rounds to the configured precision before the iso digits', () => {
    expect(formatCurrency('8.1301', 'USD', EN, 4)).toBe('$8.1301')
    expect(formatCurrency('5.25', 'USD', EN, 0)).toBe('$5')
    expect(formatCurrency('5.1234', 'KWD', EN, 2)?.replace(/\s/g, ' ')).toBe('KWD 5.12')
  })

  it('shows every digit when the currency precision is unknown', () => {
    expect(formatCurrency('0.000000000000000003', 'ETH', EN)?.replace(/\s/g, ' ')).toBe('ETH 0.000000000000000003')
    expect(formatCurrency('5.123456', 'XYZ', EN)?.replace(/\s/g, ' ')).toBe('XYZ 5.123456')
  })

  it('shows every digit when the caller opts in', () => {
    expect(formatCurrency('12.3456', 'USD', EN, null, { showAllDigits: true })).toBe('$12.3456')
    expect(formatCurrency('0.000000000000000000000000000001', 'USD', EN, null, { showAllDigits: true })).toBe(
      '$0.000000000000000000000000000001',
    )
    expect(formatCurrency('5', 'KWD', EN, null, { showAllDigits: true })?.replace(/\s/g, ' ')).toBe('KWD 5.000')
  })

  it('pads to the ISO digits of the currency', () => {
    expect(formatCurrency('5', 'KWD', EN)?.replace(/\s/g, ' ')).toBe('KWD 5.000')
    expect(formatCurrency('1234', 'JPY', EN)).toBe('¥1,234')
    expect(formatCurrency('5', 'XYZ', EN)?.replace(/\s/g, ' ')).toBe('XYZ 5.00')
  })

  it('pads to the configured precision when it is lower than the ISO digits', () => {
    expect(formatCurrency('5', 'USD', EN, 0)).toBe('$5')
  })

  it('hides float noise of a number value', () => {
    expect(formatCurrency(0.1 + 0.2, 'USD', EN)).toBe('$0.30')
    expect(formatCurrency(1.5 * 33.33, 'USD', EN)).toBe('$50.00')
  })

  it('preserves safe integers and cents beyond fifteen significant digits', () => {
    expect(formatCurrency(Number.MAX_SAFE_INTEGER, 'USD', EN)).toBe('$9,007,199,254,740,991.00')
    expect(formatCurrency(99999999999999.98, 'USD', EN)).toBe('$99,999,999,999,999.98')
    expect(formatCurrency(1234567890123456, null, EN)).toBe('1,234,567,890,123,456')
  })

  it('formats numbers too large for an exact decimal', () => {
    expect(formatCurrency(1e300, 'USD', EN)).toMatch(/^\$1,000,000/)
    expect(formatCurrency(1e300, null, EN)).toMatch(/^1,000,000/)
  })

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
    expect(formatCurrency(1.23456, null, EN)).toBe('1.235')
    expect(formatCurrency('1.23456', undefined, EN)).toBe('1.235')
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
    expect(formatDate(LOCAL_MIDDAY, EN)).toBe('Jun 9, 2026')
  })

  it('formats in the requested locale rather than the runtime default', () => {
    expect(formatDate(LOCAL_MIDDAY, PL)).toBe('9 cze 2026')
  })
})
