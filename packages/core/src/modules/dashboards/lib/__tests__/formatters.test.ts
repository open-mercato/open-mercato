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

describe('formatters', () => {
  describe('formatCurrency', () => {
    it('formats positive numbers as currency', () => {
      const result = formatCurrency(1234)
      expect(result).toMatch(/\$?1,?234/)
    })

    it('formats zero', () => {
      const result = formatCurrency(0)
      expect(result).toMatch(/\$?0/)
    })

    it('formats negative numbers', () => {
      const result = formatCurrency(-500)
      expect(result).toMatch(/-?\$?500/)
    })

    it('uses custom currency', () => {
      const result = formatCurrency(100, { currency: 'EUR' })
      expect(result).toMatch(/€|EUR/)
    })

    it('respects minimumFractionDigits', () => {
      const result = formatCurrency(100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      expect(result).toMatch(/100\.00|100,00/)
    })

    it('respects maximumFractionDigits', () => {
      const result = formatCurrency(100.999, { maximumFractionDigits: 2 })
      expect(result).toMatch(/101/)
    })
  })

  describe('formatCurrencyWithDecimals', () => {
    it('formats with 2 decimal places by default', () => {
      const result = formatCurrencyWithDecimals(100)
      expect(result).toMatch(/100\.00|100,00/)
    })

    it('rounds to 2 decimal places', () => {
      const result = formatCurrencyWithDecimals(99.999)
      expect(result).toMatch(/100\.00|100,00/)
    })

    it('shows trailing zeros', () => {
      const result = formatCurrencyWithDecimals(50)
      expect(result).toMatch(/50\.00|50,00/)
    })
  })

  describe('formatCurrencyCompact', () => {
    it('formats millions with M suffix', () => {
      expect(formatCurrencyCompact(1000000)).toBe('1.0M')
      expect(formatCurrencyCompact(2500000)).toBe('2.5M')
      expect(formatCurrencyCompact(10000000)).toBe('10.0M')
    })

    it('formats thousands with K suffix', () => {
      expect(formatCurrencyCompact(1000)).toBe('1.0K')
      expect(formatCurrencyCompact(5500)).toBe('5.5K')
      expect(formatCurrencyCompact(999000)).toBe('999.0K')
    })

    it('formats small numbers without suffix', () => {
      expect(formatCurrencyCompact(500)).toBe('500')
      expect(formatCurrencyCompact(0)).toBe('0')
      expect(formatCurrencyCompact(999)).toBe('999')
    })

    it('handles negative values', () => {
      expect(formatCurrencyCompact(-1000000)).toBe('-1.0M')
      expect(formatCurrencyCompact(-5000)).toBe('-5.0K')
      expect(formatCurrencyCompact(-500)).toBe('-500')
    })

    it('uses custom currency symbol', () => {
      expect(formatCurrencyCompact(1000000, '€')).toBe('€1.0M')
      expect(formatCurrencyCompact(5000, '£')).toBe('£5.0K')
    })

    it('resolves the symbol from an ISO currency code', () => {
      expect(formatCurrencyCompact(1000000, { currency: 'USD', locale: 'en-US' })).toBe('$1.0M')
      expect(formatCurrencyCompact(5000, { currency: 'PLN', locale: 'pl-PL' })).toMatch(/5,0.*tys\..*zł/)
    })

    it('uses locale-aware compact notation and currency placement', () => {
      const result = formatCurrencyCompact(-1_500_000, { currency: 'PLN', locale: 'pl-PL' })
      expect(result).toMatch(/-1,5.*mln.*zł/)
    })
  })

  describe('formatCurrencySafe', () => {
    it('formats valid numbers', () => {
      const result = formatCurrencySafe(1234)
      expect(result).toMatch(/\$?1,?234/)
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
      const result = formatCurrencySafe('1234')
      expect(result).toMatch(/\$?1,?234/)
    })

    it('uses custom fallback', () => {
      expect(formatCurrencySafe(null, 'N/A')).toBe('N/A')
      expect(formatCurrencySafe(undefined, '-')).toBe('-')
    })

    it('formats in the requested currency', () => {
      expect(formatCurrencySafe(1234, '--', { currency: 'PLN' })).toMatch(/zł|PLN/)
    })
  })

  describe('currency labelling (#4620)', () => {
    it('never labels an amount when no currency is known', () => {
      expect(formatCurrency(1234)).not.toMatch(/\$|USD/)
      expect(formatCurrencyWithDecimals(1234)).not.toMatch(/\$|USD/)
      expect(formatCurrencyCompact(1234)).not.toMatch(/\$|USD/)
      expect(formatCurrencySafe(1234)).not.toMatch(/\$|USD/)
    })

    it('labels the amount with the tenant currency when it is known', () => {
      expect(formatCurrency(1234, { currency: 'PLN' })).toMatch(/zł|PLN/)
      expect(formatCurrency(1234, { currency: 'pln' })).toMatch(/zł|PLN/)
    })

    it('falls back to an appended code for an unknown currency', () => {
      expect(formatCurrency(1234, { currency: 'ZZZ' })).toMatch(/ZZZ/)
    })

    it('ignores values that are not ISO currency codes', () => {
      expect(formatCurrency(1234, { currency: '' })).not.toMatch(/[A-Za-z]/)
      expect(formatCurrency(1234, { currency: null })).not.toMatch(/[A-Za-z]/)
    })
  })

  describe('createCurrencyFormatters', () => {
    it('binds the currency into single-argument formatters', () => {
      const money = createCurrencyFormatters('PLN', '--', 'pl-PL')
      expect(money.currency).toBe('PLN')
      expect(money.format(1234)).toMatch(/zł|PLN/)
      expect(money.formatWithDecimals(1234)).toMatch(/zł|PLN/)
      expect(money.formatCompact(1_000_000)).toMatch(/1,0.*mln.*zł/)
      expect(money.formatSafe(1234)).toMatch(/zł|PLN/)
    })

    it('ignores extra arguments passed by chart libraries', () => {
      const money = createCurrencyFormatters('PLN')
      const formatter = money.formatCompact as (value: number, ...rest: unknown[]) => string
      expect(formatter(1_000_000, 0)).toBe(money.formatCompact(1_000_000))
    })

    it('leaves amounts unlabelled when the currency is unknown', () => {
      const money = createCurrencyFormatters(null, '--', 'pl-PL')
      expect(money.currency).toBeNull()
      expect(money.format(1234)).not.toMatch(/\$|USD/)
      expect(money.formatCompact(1_000_000)).toMatch(/1,0.*mln/)
      expect(money.formatSafe(null)).toBe('--')
    })
  })
})
