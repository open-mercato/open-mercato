import { ISO_639_1, isValidIso639, getIso639Label } from '../iso639'

describe('ISO 639-1 utilities', () => {
  describe('ISO_639_1 array', () => {
    it('contains 183 entries', () => {
      expect(ISO_639_1).toHaveLength(183)
    })

    it('has all unique codes', () => {
      const codes = ISO_639_1.map((e) => e.code)
      expect(new Set(codes).size).toBe(codes.length)
    })

    it('has all lowercase 2-letter codes', () => {
      for (const entry of ISO_639_1) {
        expect(entry.code).toMatch(/^[a-z]{2}$/)
      }
    })

    it('has non-empty labels for every entry', () => {
      for (const entry of ISO_639_1) {
        expect(entry.label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('isValidIso639', () => {
    it('returns true for common valid codes', () => {
      expect(isValidIso639('en')).toBe(true)
      expect(isValidIso639('fr')).toBe(true)
      expect(isValidIso639('ja')).toBe(true)
      expect(isValidIso639('zh')).toBe(true)
      expect(isValidIso639('pl')).toBe(true)
    })

    it('returns false for invalid 2-letter code', () => {
      expect(isValidIso639('xx')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isValidIso639('')).toBe(false)
    })

    it('returns false for too-long string', () => {
      expect(isValidIso639('english')).toBe(false)
    })

    it('handles uppercase input (case insensitive)', () => {
      expect(isValidIso639('EN')).toBe(true)
      expect(isValidIso639('Fr')).toBe(true)
    })

    it('handles whitespace-padded input', () => {
      expect(isValidIso639(' fr ')).toBe(true)
      expect(isValidIso639('  en  ')).toBe(true)
    })

    it('returns false for single character', () => {
      expect(isValidIso639('e')).toBe(false)
    })
  })

  describe('getIso639Label', () => {
    it('returns label for valid code', () => {
      expect(getIso639Label('en')).toBe('English')
    })

    it('returns label for Polish', () => {
      expect(getIso639Label('pl')).toBe('Polish')
    })

    it('returns undefined for invalid code', () => {
      expect(getIso639Label('xx')).toBeUndefined()
    })

    it('handles uppercase input (case insensitive)', () => {
      expect(getIso639Label('FR')).toBe('French')
    })

    it('handles whitespace-padded input', () => {
      expect(getIso639Label(' de ')).toBe('German')
    })

    it('returns undefined for empty string', () => {
      expect(getIso639Label('')).toBeUndefined()
    })
  })
})
