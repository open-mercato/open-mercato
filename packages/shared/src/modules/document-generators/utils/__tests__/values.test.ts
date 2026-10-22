import { firstText, toIso, toNumber, toText } from '../values'

describe('document value helpers', () => {
  it('toText trims and drops empty values', () => {
    expect(toText('  hi ')).toBe('hi')
    expect(toText('   ')).toBeUndefined()
    expect(toText(3)).toBeUndefined()
  })

  it('firstText returns the first non-empty text', () => {
    expect(firstText(undefined, ' ', 'a', 'b')).toBe('a')
    expect(firstText(null, 1)).toBeUndefined()
  })

  it('toNumber parses decimal strings and falls back to zero', () => {
    expect(toNumber('12.3400')).toBe(12.34)
    expect(toNumber(7)).toBe(7)
    expect(toNumber('abc')).toBe(0)
    expect(toNumber(null)).toBe(0)
    expect(toNumber(Number.NaN)).toBe(0)
  })

  it('toIso converts dates and rejects invalid values', () => {
    expect(toIso(new Date('2026-01-02T10:00:00.000Z'))).toBe('2026-01-02T10:00:00.000Z')
    expect(toIso('2026-01-02T10:00:00.000Z')).toBe('2026-01-02T10:00:00.000Z')
    expect(toIso('nope')).toBeNull()
    expect(toIso(null)).toBeNull()
    expect(toIso(undefined)).toBeNull()
  })
})
