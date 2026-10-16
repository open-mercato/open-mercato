import { isMatchingApiKey } from '../mcp-dev-server'

describe('isMatchingApiKey', () => {
  test('accepts an exact match', () => {
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-key')).toBe(true)
  })

  test('rejects a mismatched key of the same length', () => {
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-kex')).toBe(false)
  })

  test('rejects a shorter or longer provided value without throwing', () => {
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-ke')).toBe(false)
    expect(isMatchingApiKey('omk_secret-key', 'omk_secret-key-extra')).toBe(false)
  })

  test('rejects an empty provided value', () => {
    expect(isMatchingApiKey('omk_secret-key', '')).toBe(false)
  })
})
