import { parseDuration } from '../duration'

describe('parseDuration', () => {
  describe('ISO 8601 format', () => {
    test('PT5M → 5 minutes', () => {
      expect(parseDuration('PT5M')).toBe(5 * 60 * 1000)
    })

    test('PT1H → 1 hour', () => {
      expect(parseDuration('PT1H')).toBe(60 * 60 * 1000)
    })

    test('PT30S → 30 seconds', () => {
      expect(parseDuration('PT30S')).toBe(30 * 1000)
    })

    test('P1D → 1 day', () => {
      expect(parseDuration('P1D')).toBe(24 * 60 * 60 * 1000)
    })

    test('P3D → 3 days', () => {
      expect(parseDuration('P3D')).toBe(3 * 24 * 60 * 60 * 1000)
    })

    test('PT1H30M → 1 hour 30 minutes', () => {
      expect(parseDuration('PT1H30M')).toBe(90 * 60 * 1000)
    })

    test('P1DT2H3M4S → combined', () => {
      const expected =
        1 * 24 * 60 * 60 * 1000 +
        2 * 60 * 60 * 1000 +
        3 * 60 * 1000 +
        4 * 1000
      expect(parseDuration('P1DT2H3M4S')).toBe(expected)
    })
  })

  describe('simple format', () => {
    test('5m → 5 minutes', () => {
      expect(parseDuration('5m')).toBe(5 * 60 * 1000)
    })

    test('1h → 1 hour', () => {
      expect(parseDuration('1h')).toBe(60 * 60 * 1000)
    })

    test('3d → 3 days', () => {
      expect(parseDuration('3d')).toBe(3 * 24 * 60 * 60 * 1000)
    })

    test('30s → 30 seconds', () => {
      expect(parseDuration('30s')).toBe(30 * 1000)
    })
  })

  describe('error cases', () => {
    test('throws on invalid string', () => {
      expect(() => parseDuration('invalid')).toThrow('Invalid duration format')
    })

    test('throws on unsupported format', () => {
      expect(() => parseDuration('2hours')).toThrow('Invalid duration format')
    })

    test('throws on random text', () => {
      expect(() => parseDuration('abc')).toThrow('Invalid duration format')
    })
  })
})
