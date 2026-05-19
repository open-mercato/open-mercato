import {
  DEFAULT_SEARCH_MIN_TOKEN_LENGTH,
  resolveSearchConfig,
  resolveSearchMinTokenLength,
} from '../config'

describe('resolveSearchMinTokenLength', () => {
  const originalValue = process.env.OM_SEARCH_MIN_LEN

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.OM_SEARCH_MIN_LEN
    } else {
      process.env.OM_SEARCH_MIN_LEN = originalValue
    }
  })

  it('returns the default when OM_SEARCH_MIN_LEN is unset', () => {
    delete process.env.OM_SEARCH_MIN_LEN
    expect(resolveSearchMinTokenLength()).toBe(DEFAULT_SEARCH_MIN_TOKEN_LENGTH)
  })

  it('parses a positive integer', () => {
    process.env.OM_SEARCH_MIN_LEN = '4'
    expect(resolveSearchMinTokenLength()).toBe(4)
  })

  it('falls back to the default for non-numeric values', () => {
    process.env.OM_SEARCH_MIN_LEN = 'abc'
    expect(resolveSearchMinTokenLength()).toBe(DEFAULT_SEARCH_MIN_TOKEN_LENGTH)
  })

  it('falls back to the default for values below the floor', () => {
    process.env.OM_SEARCH_MIN_LEN = '0'
    expect(resolveSearchMinTokenLength()).toBe(DEFAULT_SEARCH_MIN_TOKEN_LENGTH)
  })

  it('keeps resolveSearchConfig().minTokenLength in sync', () => {
    process.env.OM_SEARCH_MIN_LEN = '5'
    expect(resolveSearchConfig().minTokenLength).toBe(resolveSearchMinTokenLength())
  })
})
