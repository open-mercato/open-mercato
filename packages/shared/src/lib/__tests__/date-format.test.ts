import { toDateInputValue } from '../date/format'

describe('toDateInputValue', () => {
  describe('null/undefined/empty handling', () => {
    it('returns null for null', () => {
      expect(toDateInputValue(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(toDateInputValue(undefined)).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(toDateInputValue('')).toBeNull()
    })

    it('returns null for whitespace-only string', () => {
      expect(toDateInputValue('   ')).toBeNull()
    })
  })

  describe('Date object handling', () => {
    it('converts a valid Date to YYYY-MM-DD', () => {
      const date = new Date('2026-03-15T14:30:00Z')
      expect(toDateInputValue(date)).toBe('2026-03-15')
    })

    it('returns null for an invalid Date', () => {
      expect(toDateInputValue(new Date('invalid'))).toBeNull()
    })

    it('handles Date at epoch', () => {
      expect(toDateInputValue(new Date(0))).toBe('1970-01-01')
    })
  })

  describe('ISO string handling', () => {
    it('extracts date from ISO-8601 timestamp', () => {
      expect(toDateInputValue('2026-04-11T18:44:27Z')).toBe('2026-04-11')
    })

    it('extracts date from ISO-8601 with offset', () => {
      expect(toDateInputValue('2026-04-11T18:44:27+02:00')).toBe('2026-04-11')
    })

    it('passes through YYYY-MM-DD string unchanged', () => {
      expect(toDateInputValue('2026-04-11')).toBe('2026-04-11')
    })

    it('trims whitespace before parsing', () => {
      expect(toDateInputValue('  2026-04-11  ')).toBe('2026-04-11')
    })

    it('truncates YYYY-MM-DD with trailing time info', () => {
      expect(toDateInputValue('2026-04-11T00:00:00.000Z')).toBe('2026-04-11')
    })
  })

  describe('unparseable strings', () => {
    it('returns null for non-date strings', () => {
      expect(toDateInputValue('not-a-date')).toBeNull()
    })

    it('returns null for partial date strings', () => {
      expect(toDateInputValue('2026-13')).toBeNull()
    })
  })
})
