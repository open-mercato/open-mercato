import { parseLocaleNumber, parseNumberWithDefault, resolveLocaleNumberSeparators } from '../number'

describe('parseNumberWithDefault', () => {
  it('returns the fallback when raw is missing or blank', () => {
    expect(parseNumberWithDefault(undefined, 5)).toBe(5)
    expect(parseNumberWithDefault(null, 5)).toBe(5)
    expect(parseNumberWithDefault('', 5)).toBe(5)
    expect(parseNumberWithDefault('   ', 5)).toBe(5)
  })

  it('parses a valid numeric string', () => {
    expect(parseNumberWithDefault('42', 0)).toBe(42)
    expect(parseNumberWithDefault(' 42 ', 0)).toBe(42)
  })

  it('allows decimals by default, but truncates when integer: true', () => {
    expect(parseNumberWithDefault('4.5', 0)).toBe(4.5)
    expect(parseNumberWithDefault('4.5', 0, { integer: true })).toBe(4)
  })

  it('falls back to the default on a non-numeric string', () => {
    expect(parseNumberWithDefault('not-a-number', 7)).toBe(7)
  })

  it('falls back to the default when below the configured min', () => {
    expect(parseNumberWithDefault('-1', 3, { min: 0 })).toBe(3)
    expect(parseNumberWithDefault('0', 3, { min: 0 })).toBe(0)
  })

  it('has no min by default, so negative values are accepted', () => {
    expect(parseNumberWithDefault('-5', 0)).toBe(-5)
  })
})

describe('resolveLocaleNumberSeparators', () => {
  it('derives the separators from Intl rather than assuming a comma/dot pair', () => {
    expect(resolveLocaleNumberSeparators('en-US')).toEqual({ group: ',', decimal: '.' })
    expect(resolveLocaleNumberSeparators('de-DE')).toEqual({ group: '.', decimal: ',' })
    expect(resolveLocaleNumberSeparators('pl-PL').decimal).toBe(',')
    expect(resolveLocaleNumberSeparators('fr-FR').decimal).toBe(',')
  })

  it('reports a whitespace group separator for locales that group with spaces', () => {
    expect(resolveLocaleNumberSeparators('fr-FR').group).toMatch(/^\s$/)
    expect(resolveLocaleNumberSeparators('pl-PL').group).toMatch(/^\s$/)
  })
})

describe('parseLocaleNumber', () => {
  it('accepts the locale decimal separator the UI displays (issue #5552)', () => {
    expect(parseLocaleNumber('110,70', 'pl-PL')).toBe(110.7)
    expect(parseLocaleNumber('2,5', 'pl-PL')).toBe(2.5)
    expect(parseLocaleNumber('110,70', 'de-DE')).toBe(110.7)
    expect(parseLocaleNumber('110,70', 'fr-FR')).toBe(110.7)
    expect(parseLocaleNumber('110.70', 'en-US')).toBe(110.7)
  })

  it('keeps accepting a dot under a comma-decimal locale, so the old input still works', () => {
    expect(parseLocaleNumber('110.70', 'pl-PL')).toBe(110.7)
    expect(parseLocaleNumber('2.5', 'de-DE')).toBe(2.5)
    expect(parseLocaleNumber('0.01', 'fr-FR')).toBe(0.01)
  })

  it('parses grouped input, including whitespace and apostrophe group separators', () => {
    expect(parseLocaleNumber('1\u00A0234,56', 'pl-PL')).toBe(1234.56)
    expect(parseLocaleNumber('1\u202F234,56', 'pl-PL')).toBe(1234.56)
    expect(parseLocaleNumber('1 234,56', 'fr-FR')).toBe(1234.56)
    expect(parseLocaleNumber('1.234.567,89', 'de-DE')).toBe(1234567.89)
    expect(parseLocaleNumber('1,234,567.89', 'en-US')).toBe(1234567.89)
    expect(parseLocaleNumber('1’234.5', 'de-CH')).toBe(1234.5)
  })

  it('reads a lone separator as the decimal point, never as grouping', () => {
    // A dot-grouping locale reading `1.500` as 1500 is a silent 1000x on a money field,
    // and three- and four-decimal unit prices are ordinary here.
    expect(parseLocaleNumber('1.500', 'de-DE')).toBe(1.5)
    expect(parseLocaleNumber('2.500', 'es')).toBe(2.5)
    expect(parseLocaleNumber('1.23', 'de-DE')).toBe(1.23)
    expect(parseLocaleNumber('1,500', 'en-US')).toBe(1.5)
    expect(parseLocaleNumber('1,23', 'en-US')).toBe(1.23)
  })

  it('recognizes grouping only where it is unambiguous', () => {
    expect(parseLocaleNumber('1.234.567', 'de-DE')).toBe(1234567)
    expect(parseLocaleNumber('1,234,567', 'en-US')).toBe(1234567)
    expect(parseLocaleNumber('1 234', 'de-DE')).toBe(1234)
    expect(parseLocaleNumber('1’234', 'de-CH')).toBe(1234)
  })

  it('does not absorb whitespace or apostrophes outside a valid grouping position', () => {
    expect(parseLocaleNumber('1 2', 'en-US')).toBeNull()
    expect(parseLocaleNumber("1'2", 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('1 2345', 'fr-FR')).toBeNull()
  })

  it('handles signs, blank fractions and exponent notation', () => {
    expect(parseLocaleNumber('-110,70', 'pl-PL')).toBe(-110.7)
    expect(parseLocaleNumber('−110,70', 'pl-PL')).toBe(-110.7)
    expect(parseLocaleNumber('+7', 'pl-PL')).toBe(7)
    expect(parseLocaleNumber('110,', 'pl-PL')).toBe(110)
    expect(parseLocaleNumber(',5', 'pl-PL')).toBe(0.5)
    expect(parseLocaleNumber('1e3', 'en-US')).toBe(1000)
    expect(parseLocaleNumber('0', 'pl-PL')).toBe(0)
  })

  it('returns null instead of a silent zero for unparseable input', () => {
    expect(parseLocaleNumber('', 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('   ', 'pl-PL')).toBeNull()
    expect(parseLocaleNumber(null, 'pl-PL')).toBeNull()
    expect(parseLocaleNumber(undefined, 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('abc', 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('-', 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('110,70,5', 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('1.2.3', 'en-US')).toBeNull()
    expect(parseLocaleNumber('12,34 PLN', 'pl-PL')).toBeNull()
    expect(parseLocaleNumber('1,23,456', 'en-US')).toBeNull()
  })

  it('falls back to comma-group/dot-decimal when the locale tag is unusable', () => {
    expect(parseLocaleNumber('1,234.5', 'not a locale')).toBe(1234.5)
    expect(parseLocaleNumber('110.70', undefined)).toBe(110.7)
  })
})
