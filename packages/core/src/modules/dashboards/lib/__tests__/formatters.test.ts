/**
 * @jest-environment node
 */
import {
  createCurrencyFormatters,
  formatCurrency,
  formatCurrencyWithDecimals,
  formatCurrencyCompact,
  formatCurrencySafe,
} from '../formatters'

// Every assertion below pins the locale explicitly (#5105). Without it these tests read the
// runtime's default locale, so they pass in en-US and fail on any contributor machine whose
// default is something else — e.g. `formatCurrencyCompact(1_000_000)` renders "1,0 mln" in pl-PL.
const EN = 'en-US'
const PL = 'pl-PL'

describe('formatters', () => {
  describe('formatCurrency', () => {
    it('formats positive numbers as currency', () => {
      expect(formatCurrency(1234, { locale: EN })).toBe('1,234')
    })

    it('formats zero', () => {
      expect(formatCurrency(0, { locale: EN })).toBe('0')
    })

    it('formats negative numbers', () => {
      expect(formatCurrency(-500, { locale: EN })).toBe('-500')
    })

    it('uses custom currency', () => {
      expect(formatCurrency(100, { currency: 'EUR', locale: EN })).toBe('€100')
    })

    it('respects minimumFractionDigits', () => {
      const result = formatCurrency(100, { minimumFractionDigits: 2, maximumFractionDigits: 2, locale: EN })
      expect(result).toBe('100.00')
    })

    it('respects maximumFractionDigits', () => {
      expect(formatCurrency(100.999, { maximumFractionDigits: 2, locale: EN })).toBe('101')
    })

    it('formats in the requested locale rather than the runtime default', () => {
      expect(formatCurrency(1234, { minimumFractionDigits: 2, maximumFractionDigits: 2, locale: PL })).toBe('1234,00')
    })
  })

  describe('formatCurrencyWithDecimals', () => {
    it('formats with 2 decimal places by default', () => {
      expect(formatCurrencyWithDecimals(100, { locale: EN })).toBe('100.00')
    })

    it('rounds to 2 decimal places', () => {
      expect(formatCurrencyWithDecimals(99.999, { locale: EN })).toBe('100.00')
    })

    it('shows trailing zeros', () => {
      expect(formatCurrencyWithDecimals(50, { locale: EN })).toBe('50.00')
    })
  })

  describe('formatCurrencyCompact', () => {
    it('formats millions with M suffix', () => {
      expect(formatCurrencyCompact(1000000, { locale: EN })).toBe('1.0M')
      expect(formatCurrencyCompact(2500000, { locale: EN })).toBe('2.5M')
      expect(formatCurrencyCompact(10000000, { locale: EN })).toBe('10.0M')
    })

    it('formats thousands with K suffix', () => {
      expect(formatCurrencyCompact(1000, { locale: EN })).toBe('1.0K')
      expect(formatCurrencyCompact(5500, { locale: EN })).toBe('5.5K')
      expect(formatCurrencyCompact(999000, { locale: EN })).toBe('999.0K')
    })

    it('formats small numbers without suffix', () => {
      expect(formatCurrencyCompact(500, { locale: EN })).toBe('500')
      expect(formatCurrencyCompact(0, { locale: EN })).toBe('0')
      expect(formatCurrencyCompact(999, { locale: EN })).toBe('999')
    })

    it('handles negative values', () => {
      expect(formatCurrencyCompact(-1000000, { locale: EN })).toBe('-1.0M')
      expect(formatCurrencyCompact(-5000, { locale: EN })).toBe('-5.0K')
      expect(formatCurrencyCompact(-500, { locale: EN })).toBe('-500')
    })

    it('uses custom currency symbol', () => {
      // A literal symbol bypasses Intl entirely, so this path is locale-independent by design.
      expect(formatCurrencyCompact(1000000, '€')).toBe('€1.0M')
      expect(formatCurrencyCompact(5000, '£')).toBe('£5.0K')
    })

    it('resolves the symbol from an ISO currency code', () => {
      expect(formatCurrencyCompact(1000000, { currency: 'USD', locale: EN })).toBe('$1.0M')
      expect(formatCurrencyCompact(5000, { currency: 'PLN', locale: PL })).toMatch(/5,0.*tys\..*zł/)
    })

    it('uses locale-aware compact notation and currency placement', () => {
      const result = formatCurrencyCompact(-1_500_000, { currency: 'PLN', locale: PL })
      expect(result).toMatch(/-1,5.*mln.*zł/)
    })
  })

  describe('formatCurrencySafe', () => {
    it('formats valid numbers', () => {
      expect(formatCurrencySafe(1234, '--', { locale: EN })).toBe('1,234')
    })

    it('returns fallback for null', () => {
      expect(formatCurrencySafe(null)).toBe('--')
    })

    it('returns fallback for undefined', () => {
      expect(formatCurrencySafe(undefined)).toBe('--')
    })

    it('returns fallback for NaN', () => {
      expect(formatCurrencySafe(NaN)).toBe('--')
    })

    it('returns fallback for Infinity', () => {
      expect(formatCurrencySafe(Infinity)).toBe('--')
    })

    it('returns fallback for non-numeric strings', () => {
      expect(formatCurrencySafe('not a number')).toBe('--')
    })

    it('converts numeric strings to numbers', () => {
      expect(formatCurrencySafe('1234', '--', { locale: EN })).toBe('1,234')
    })

    it('uses custom fallback', () => {
      expect(formatCurrencySafe(null, 'N/A')).toBe('N/A')
      expect(formatCurrencySafe(undefined, '-')).toBe('-')
    })

    it('formats in the requested currency', () => {
      // Intl separates the code from the amount with a non-breaking space, hence `\s` over a literal.
      expect(formatCurrencySafe(1234, '--', { currency: 'PLN', locale: EN })).toMatch(/^PLN\s1,234$/)
    })
  })

  describe('currency labelling (#4620)', () => {
    it('never labels an amount when no currency is known', () => {
      expect(formatCurrency(1234, { locale: EN })).not.toMatch(/\$|USD/)
      expect(formatCurrencyWithDecimals(1234, { locale: EN })).not.toMatch(/\$|USD/)
      expect(formatCurrencyCompact(1234, { locale: EN })).not.toMatch(/\$|USD/)
      expect(formatCurrencySafe(1234, '--', { locale: EN })).not.toMatch(/\$|USD/)
    })

    it('labels the amount with the tenant currency when it is known', () => {
      expect(formatCurrency(1234, { currency: 'PLN', locale: EN })).toMatch(/^PLN\s1,234$/)
      expect(formatCurrency(1234, { currency: 'pln', locale: EN })).toMatch(/^PLN\s1,234$/)
    })

    it('falls back to an appended code for an unknown currency', () => {
      expect(formatCurrency(1234, { currency: 'ZZZ', locale: EN })).toMatch(/ZZZ/)
    })

    it('ignores values that are not ISO currency codes', () => {
      expect(formatCurrency(1234, { currency: '', locale: EN })).not.toMatch(/[A-Za-z]/)
      expect(formatCurrency(1234, { currency: null, locale: EN })).not.toMatch(/[A-Za-z]/)
    })
  })

  describe('createCurrencyFormatters', () => {
    it('binds the currency into single-argument formatters', () => {
      const money = createCurrencyFormatters('PLN', '--', PL)
      expect(money.currency).toBe('PLN')
      expect(money.format(1234)).toMatch(/zł|PLN/)
      expect(money.formatWithDecimals(1234)).toMatch(/zł|PLN/)
      expect(money.formatCompact(1_000_000)).toMatch(/1,0.*mln.*zł/)
      expect(money.formatSafe(1234)).toMatch(/zł|PLN/)
    })

    it('ignores extra arguments passed by chart libraries', () => {
      const money = createCurrencyFormatters('PLN', '--', EN)
      const formatter = money.formatCompact as (value: number, ...rest: unknown[]) => string
      expect(formatter(1_000_000, 0)).toBe(money.formatCompact(1_000_000))
    })

    it('leaves amounts unlabelled when the currency is unknown', () => {
      const money = createCurrencyFormatters(null, '--', PL)
      expect(money.currency).toBeNull()
      expect(money.format(1234)).not.toMatch(/\$|USD/)
      expect(money.formatCompact(1_000_000)).toMatch(/1,0.*mln/)
      expect(money.formatSafe(null)).toBe('--')
    })
  })
})
