import { canonicalizeDecimalToken, valuesEqual } from '../lib/conflictValues'

describe('canonicalizeDecimalToken', () => {
  test('canonicalizes decimal scalars written with different scales', () => {
    expect(canonicalizeDecimalToken('980.0000')).toBe('980')
    expect(canonicalizeDecimalToken(980)).toBe('980')
    expect(canonicalizeDecimalToken('0980.50')).toBe('980.5')
    expect(canonicalizeDecimalToken('-0.0')).toBe('0')
    expect(canonicalizeDecimalToken('+12.3400')).toBe('12.34')
    expect(canonicalizeDecimalToken('.5')).toBe('0.5')
  })

  test('refuses values that are not plain decimal literals', () => {
    expect(canonicalizeDecimalToken('')).toBeNull()
    expect(canonicalizeDecimalToken('   ')).toBeNull()
    expect(canonicalizeDecimalToken(null)).toBeNull()
    expect(canonicalizeDecimalToken(undefined)).toBeNull()
    expect(canonicalizeDecimalToken(true)).toBeNull()
    expect(canonicalizeDecimalToken('0x10')).toBeNull()
    expect(canonicalizeDecimalToken('1e3')).toBeNull()
    expect(canonicalizeDecimalToken('980 PLN')).toBeNull()
    expect(canonicalizeDecimalToken(Number.NaN)).toBeNull()
    expect(canonicalizeDecimalToken(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('valuesEqual — decimal scalars', () => {
  test('treats the same amount written with different scale as unchanged (#5985)', () => {
    expect(valuesEqual('980.0000', 980)).toBe(true)
    expect(valuesEqual(980, '980.0000')).toBe(true)
    expect(valuesEqual('980.0000', '980')).toBe(true)
    expect(valuesEqual('980.5000', 980.5)).toBe(true)
    expect(valuesEqual('-12.500', -12.5)).toBe(true)
  })

  test('still reports genuinely different amounts as changed', () => {
    expect(valuesEqual('980.5', 980)).toBe(false)
    expect(valuesEqual(980.5, '980.0000')).toBe(false)
    expect(valuesEqual('980.0001', 980)).toBe(false)
    expect(valuesEqual('10000000000000000001', '10000000000000000002')).toBe(false)
  })

  test('does not coerce non-decimal scalars into numbers', () => {
    expect(valuesEqual('', 0)).toBe(false)
    expect(valuesEqual(null, 0)).toBe(false)
    expect(valuesEqual(undefined, 0)).toBe(false)
    expect(valuesEqual(true, 1)).toBe(false)
    expect(valuesEqual(false, 0)).toBe(false)
    expect(valuesEqual([], 0)).toBe(false)
  })

  test('keeps the existing identity, date, array and record semantics', () => {
    expect(valuesEqual(null, null)).toBe(true)
    expect(valuesEqual('draft', 'draft')).toBe(true)
    expect(valuesEqual('draft', 'sent')).toBe(false)
    expect(valuesEqual(new Date('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z')).toBe(true)
    expect(valuesEqual(new Date('2026-01-01T00:00:00.000Z'), '2026-01-02T00:00:00.000Z')).toBe(false)
    expect(valuesEqual([1, '2.00'], ['1.000', 2])).toBe(true)
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(valuesEqual({ amount: '10.00' }, { amount: 10 })).toBe(true)
    expect(valuesEqual({ amount: '10.00' }, { amount: 11 })).toBe(false)
    expect(valuesEqual({ amount: 10 }, { amount: 10, currency: 'PLN' })).toBe(false)
  })
})
