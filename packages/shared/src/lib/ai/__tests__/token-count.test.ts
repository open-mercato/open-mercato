import { countTokens, TOKEN_ENCODING } from '../token-count'

describe('countTokens', () => {
  it('returns 0 for empty / nullish input', () => {
    expect(countTokens('')).toBe(0)
    expect(countTokens(null)).toBe(0)
    expect(countTokens(undefined)).toBe(0)
  })

  it('counts more tokens for longer text', () => {
    const short = countTokens('hello')
    const long = countTokens('hello world, this is a noticeably longer sentence.')
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(short)
  })

  it('exposes the encoding label', () => {
    expect(TOKEN_ENCODING).toBe('o200k_base')
  })
})
