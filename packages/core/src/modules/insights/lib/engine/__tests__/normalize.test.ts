import { canonicalDecimal, canonicalValue, toResponseValue, valuesEqual } from '../normalize'

describe('canonicalDecimal', () => {
  it.each([
    ['10.0000', '10'],
    ['010.50', '10.5'],
    ['-0.000', '0'],
    ['+3.140', '3.14'],
    ['.5', '0.5'],
    ['7.', '7'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected)
  })

  it.each(['', '.', 'abc', '1e3', '1,5'])('rejects %p', (input) => {
    expect(canonicalDecimal(input)).toBeNull()
  })
})

describe('valuesEqual', () => {
  it('treats decimal strings and numbers with trailing zeros as equal for numeric kinds', () => {
    expect(valuesEqual('10.0000', '10', 'decimal')).toBe(true)
    expect(valuesEqual('10.0000', 10, 'money')).toBe(true)
    expect(valuesEqual(10.5, '10.50', 'number')).toBe(true)
    expect(valuesEqual('10.01', '10.1', 'decimal')).toBe(false)
  })

  it('does not apply numeric normalization to text values', () => {
    expect(valuesEqual('007', '7', 'text')).toBe(false)
    expect(valuesEqual(10, '10', 'text')).toBe(true)
  })

  it('treats null, undefined and empty strings as the same empty value', () => {
    expect(valuesEqual(null, undefined, 'text')).toBe(true)
    expect(valuesEqual('', null, 'enum')).toBe(true)
    expect(valuesEqual('', null, 'text')).toBe(true)
    expect(valuesEqual(null, 0, 'number')).toBe(false)
  })

  it('compares Date objects and ISO strings as the same instant', () => {
    const date = new Date('2026-10-08T10:15:00.000Z')
    expect(valuesEqual(date, '2026-10-08T10:15:00Z', 'datetime')).toBe(true)
    expect(valuesEqual(date, '2026-10-08T10:15:00.000+00:00', 'text')).toBe(true)
    expect(valuesEqual(date, '2026-10-08T10:15:01.000Z', 'datetime')).toBe(false)
  })

  it('compares date-only values by calendar day', () => {
    expect(valuesEqual('2026-10-08', '2026-10-08T00:00:00.000Z', 'date')).toBe(true)
    expect(valuesEqual('2026-10-08', '2026-10-09', 'date')).toBe(false)
  })

  it('normalizes boolean tokens', () => {
    expect(valuesEqual(true, 'true', 'boolean')).toBe(true)
    expect(valuesEqual(0, false, 'boolean')).toBe(true)
    expect(valuesEqual('yes', false, 'boolean')).toBe(false)
  })

  it('compares objects independently of key order', () => {
    expect(valuesEqual({ amount: '1', currency: 'EUR' }, { currency: 'EUR', amount: '1' }, 'json')).toBe(true)
    expect(valuesEqual({ amount: '1' }, { amount: '2' }, 'json')).toBe(false)
  })

  it('normalizes numeric custom field values', () => {
    expect(valuesEqual('3.00', 3, 'custom_field')).toBe(true)
    expect(valuesEqual('high', 'high', 'custom_field')).toBe(true)
  })

  it.each([
    ['a leading zero', '01234', '1234'],
    ['a leading plus sign', '+48123', '48123'],
    ['a trailing fraction zero', '1.50', '1.5'],
    ['padded digits', '007', '7'],
    ['a phone number and its local form', '+48123', '048123'],
  ])('compares custom field strings exactly when one has %s', (_label, left, right) => {
    expect(valuesEqual(left, right, 'custom_field')).toBe(false)
    expect(valuesEqual(right, left, 'custom_field')).toBe(false)
  })

  it('compares custom field strings numerically only in canonical form or against a JS number', () => {
    expect(valuesEqual(5, '5', 'custom_field')).toBe(true)
    expect(valuesEqual('5', 5n, 'custom_field')).toBe(true)
    expect(valuesEqual('1.5', '1.5', 'custom_field')).toBe(true)
    expect(valuesEqual('5', '5.0', 'custom_field')).toBe(false)
    expect(valuesEqual(5, '5.0', 'custom_field')).toBe(true)
    expect(valuesEqual('1234', 1234, 'custom_field')).toBe(true)
    expect(valuesEqual('01234', 1234, 'custom_field')).toBe(true)
    expect(canonicalValue('5.0', 'custom_field')).toBe('s:5.0')
    expect(canonicalValue('5', 'custom_field')).toBe('n:5')
  })

  it('keeps numeric kinds lenient about decimal formatting', () => {
    expect(valuesEqual('01234', '1234', 'number')).toBe(true)
    expect(valuesEqual('1.50', '1.5', 'decimal')).toBe(true)
  })

  it('keeps distinct sentinels per value family', () => {
    expect(canonicalValue('null', 'text')).not.toBe(canonicalValue(null, 'text'))
    expect(canonicalValue(true, 'text')).toBe(canonicalValue('true', 'text'))
  })
})

describe('toResponseValue', () => {
  it('serializes dates and drops undefined object members', () => {
    expect(toResponseValue({ at: new Date('2026-10-08T00:00:00.000Z'), skip: undefined, list: [1n] })).toEqual({
      at: '2026-10-08T00:00:00.000Z',
      list: ['1'],
    })
    expect(toResponseValue(undefined)).toBeNull()
  })
})
