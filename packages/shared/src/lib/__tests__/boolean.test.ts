import {
  FALSE_VALUES,
  TRUE_VALUES,
  parseBooleanFlag,
  parseBooleanFromUnknown,
  parseBooleanToken,
  parseBooleanWithDefault,
} from '../boolean'

describe('boolean helpers', () => {
  it('parses recognized truthy tokens regardless of case or surrounding whitespace', () => {
    for (const token of TRUE_VALUES) {
      expect(parseBooleanToken(token)).toBe(true)
      expect(parseBooleanToken(`  ${token.toUpperCase()}  `)).toBe(true)
    }
  })

  it('parses recognized falsy tokens regardless of case or surrounding whitespace', () => {
    for (const token of FALSE_VALUES) {
      expect(parseBooleanToken(token)).toBe(false)
      expect(parseBooleanToken(`  ${token.toUpperCase()}  `)).toBe(false)
    }
  })

  it('returns null for blank, invalid, or non-string token inputs', () => {
    expect(parseBooleanToken('')).toBeNull()
    expect(parseBooleanToken('   ')).toBeNull()
    expect(parseBooleanToken('maybe')).toBeNull()
    expect(parseBooleanToken(null)).toBeNull()
    expect(parseBooleanToken(undefined)).toBeNull()
  })

  it('falls back only when the token cannot be parsed', () => {
    expect(parseBooleanWithDefault('enabled', false)).toBe(true)
    expect(parseBooleanWithDefault('disabled', true)).toBe(false)
    expect(parseBooleanWithDefault('unknown', true)).toBe(true)
    expect(parseBooleanWithDefault(undefined, false)).toBe(false)
  })

  it('returns undefined for unparseable flags while preserving parsed booleans', () => {
    expect(parseBooleanFlag('yes')).toBe(true)
    expect(parseBooleanFlag('no')).toBe(false)
    expect(parseBooleanFlag('maybe')).toBeUndefined()
    expect(parseBooleanFlag()).toBeUndefined()
  })

  it('parses booleans from unknown values without coercing unsupported types', () => {
    expect(parseBooleanFromUnknown(true)).toBe(true)
    expect(parseBooleanFromUnknown(false)).toBe(false)
    expect(parseBooleanFromUnknown(' on ')).toBe(true)
    expect(parseBooleanFromUnknown(' off ')).toBe(false)
    expect(parseBooleanFromUnknown('unexpected')).toBeNull()
    expect(parseBooleanFromUnknown(1)).toBeNull()
    expect(parseBooleanFromUnknown({ value: 'true' })).toBeNull()
  })
})
