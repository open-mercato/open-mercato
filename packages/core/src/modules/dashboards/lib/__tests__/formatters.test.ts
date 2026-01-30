/**
 * @jest-environment node
 */
import {
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
      expect(formatCurrencyCompact(1000000)).toBe('$1.0M')
      expect(formatCurrencyCompact(2500000)).toBe('$2.5M')
      expect(formatCurrencyCompact(10000000)).toBe('$10.0M')
    })

    it('formats thousands with K suffix', () => {
      expect(formatCurrencyCompact(1000)).toBe('$1.0K')
      expect(formatCurrencyCompact(5500)).toBe('$5.5K')
      expect(formatCurrencyCompact(999000)).toBe('$999.0K')
    })

    it('formats small numbers without suffix', () => {
      expect(formatCurrencyCompact(500)).toBe('$500')
      expect(formatCurrencyCompact(0)).toBe('$0')
      expect(formatCurrencyCompact(999)).toBe('$999')
    })

    it('handles negative values', () => {
      expect(formatCurrencyCompact(-1000000)).toBe('$-1.0M')
      expect(formatCurrencyCompact(-5000)).toBe('$-5.0K')
      expect(formatCurrencyCompact(-500)).toBe('$-500')
    })

    it('uses custom currency symbol', () => {
      expect(formatCurrencyCompact(1000000, '€')).toBe('€1.0M')
      expect(formatCurrencyCompact(5000, '£')).toBe('£5.0K')
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
  })
})
