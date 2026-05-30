import { constantTimeEquals } from '../constant-time-equals'

describe('constantTimeEquals', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true)
  })

  it('returns false for different strings of the same length', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false)
  })

  it('returns false for strings of different length', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    expect(constantTimeEquals('', '')).toBe(true)
  })
})
