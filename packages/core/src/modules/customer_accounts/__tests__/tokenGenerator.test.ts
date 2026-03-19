import { generateSecureToken, hashToken } from '../lib/tokenGenerator'

describe('generateSecureToken', () => {
  it('returns a non-empty string', () => {
    const token = generateSecureToken()
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  it('returns unique values on each call', () => {
    const token1 = generateSecureToken()
    const token2 = generateSecureToken()
    expect(token1).not.toBe(token2)
  })
})

describe('hashToken', () => {
  it('returns a deterministic hash for the same input', () => {
    const token = 'test-token-value'
    const hash1 = hashToken(token)
    const hash2 = hashToken(token)
    expect(hash1).toBe(hash2)
  })

  it('returns different hashes for different inputs', () => {
    const hash1 = hashToken('token-a')
    const hash2 = hashToken('token-b')
    expect(hash1).not.toBe(hash2)
  })

  it('returns a different value than the input', () => {
    const token = 'my-secret-token'
    const hash = hashToken(token)
    expect(hash).not.toBe(token)
  })
})
