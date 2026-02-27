import { canonicalizeUnitCode, toUnitLookupKey } from '../unitCodes'

describe('canonicalizeUnitCode', () => {
  it('returns "pc" for legacy alias "qty"', () => {
    expect(canonicalizeUnitCode('qty')).toBe('pc')
  })

  it('returns "pc" for uppercase alias "QTY" (case insensitive)', () => {
    expect(canonicalizeUnitCode('QTY')).toBe('pc')
  })

  it('passes through codes without aliases unchanged', () => {
    expect(canonicalizeUnitCode('m2')).toBe('m2')
  })

  it('lowercases non-alias unit codes', () => {
    expect(canonicalizeUnitCode('KG')).toBe('kg')
    expect(canonicalizeUnitCode('M2')).toBe('m2')
  })

  it('returns null for empty string', () => {
    expect(canonicalizeUnitCode('')).toBeNull()
  })

  it('returns null for null', () => {
    expect(canonicalizeUnitCode(null)).toBeNull()
  })

  it('returns null for non-string values', () => {
    expect(canonicalizeUnitCode(42)).toBeNull()
  })

  it('trims whitespace before resolving', () => {
    expect(canonicalizeUnitCode('  kg  ')).toBe('kg')
  })

  it('returns null for undefined', () => {
    expect(canonicalizeUnitCode(undefined)).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(canonicalizeUnitCode('   ')).toBeNull()
  })
})

describe('toUnitLookupKey', () => {
  it('lowercases a standard unit code', () => {
    expect(toUnitLookupKey('KG')).toBe('kg')
  })

  it('resolves alias and lowercases the result', () => {
    expect(toUnitLookupKey('qty')).toBe('pc')
  })

  it('returns null for null input', () => {
    expect(toUnitLookupKey(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(toUnitLookupKey('')).toBeNull()
  })

  it('returns null for non-string values', () => {
    expect(toUnitLookupKey(123)).toBeNull()
  })

  it('trims and lowercases mixed-case input', () => {
    expect(toUnitLookupKey('  M2  ')).toBe('m2')
  })
})
