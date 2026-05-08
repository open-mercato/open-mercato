import { secretEqual } from '../secretCompare'

describe('secretEqual', () => {
  const expected = 'super-secret-token-abc123'

  it('returns true for an exact match', () => {
    expect(secretEqual(expected, expected)).toBe(true)
  })

  it('returns false for a different value of the same length', () => {
    const sameLengthDifferent = 'XXXXX-XXXXXX-XXXXX-XXXXXX'
    expect(sameLengthDifferent.length).toBe(expected.length)
    expect(secretEqual(sameLengthDifferent, expected)).toBe(false)
  })

  it('returns false when the supplied value differs in length', () => {
    expect(secretEqual('short', expected)).toBe(false)
    expect(secretEqual(expected + 'X', expected)).toBe(false)
  })

  it('returns false for null/undefined supplied values', () => {
    expect(secretEqual(null, expected)).toBe(false)
    expect(secretEqual(undefined, expected)).toBe(false)
  })

  it('returns false for empty supplied string', () => {
    expect(secretEqual('', expected)).toBe(false)
  })

  it('returns false when expected is empty (fail closed on missing env)', () => {
    expect(secretEqual('anything', '')).toBe(false)
    expect(secretEqual('', '')).toBe(false)
  })

  it('handles non-ASCII secrets correctly', () => {
    const utf = 'pässwørd-üñîçødé-🔐'
    expect(secretEqual(utf, utf)).toBe(true)
    expect(secretEqual(utf, utf + '!')).toBe(false)
  })
})
