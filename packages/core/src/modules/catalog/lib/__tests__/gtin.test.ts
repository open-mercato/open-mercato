import { computeGs1CheckDigit, isValidGtin, normalizeGtinValue } from '../gtin'

describe('computeGs1CheckDigit', () => {
  it('computes the EAN-13 check digit', () => {
    expect(computeGs1CheckDigit('590123412345')).toBe(7)
  })

  it('computes the EAN-8 check digit', () => {
    expect(computeGs1CheckDigit('9638507')).toBe(4)
  })

  it('computes the UPC-A check digit', () => {
    expect(computeGs1CheckDigit('03600029145')).toBe(2)
  })
})

describe('normalizeGtinValue', () => {
  it('strips whitespace from numeric identifiers', () => {
    expect(normalizeGtinValue('ean13', ' 5901234 123457 ')).toBe('5901234123457')
  })

  it('strips dashes and uppercases ISBN values', () => {
    expect(normalizeGtinValue('isbn', '83-7181-510-x')).toBe('837181510X')
  })

  it('uppercases ASIN values', () => {
    expect(normalizeGtinValue('asin', 'b00x4whp5e')).toBe('B00X4WHP5E')
  })

  it('keeps MPN values as trimmed free text', () => {
    expect(normalizeGtinValue('mpn', '  AB-1234/c  ')).toBe('AB-1234/c')
  })
})

describe('isValidGtin', () => {
  it('accepts a valid EAN-13 and rejects a checksum typo', () => {
    expect(isValidGtin('ean13', '5901234123457')).toBe(true)
    expect(isValidGtin('ean13', '5901234123456')).toBe(false)
  })

  it('rejects EAN-13 values of wrong length or with letters', () => {
    expect(isValidGtin('ean13', '59012341234')).toBe(false)
    expect(isValidGtin('ean13', '590123412345A')).toBe(false)
  })

  it('accepts a valid EAN-8 and rejects a checksum typo', () => {
    expect(isValidGtin('ean8', '96385074')).toBe(true)
    expect(isValidGtin('ean8', '96385075')).toBe(false)
  })

  it('accepts a valid UPC-A and rejects a checksum typo', () => {
    expect(isValidGtin('upc', '036000291452')).toBe(true)
    expect(isValidGtin('upc', '036000291453')).toBe(false)
  })

  it('accepts ISBN-10 with X check character and ISBN-13 digits', () => {
    expect(isValidGtin('isbn', '837181510X')).toBe(true)
    expect(isValidGtin('isbn', '9788371815102')).toBe(true)
    expect(isValidGtin('isbn', '97883718151')).toBe(false)
  })

  it('accepts a 10-character alphanumeric ASIN only', () => {
    expect(isValidGtin('asin', 'B00X4WHP5E')).toBe(true)
    expect(isValidGtin('asin', 'B00X4WHP5')).toBe(false)
    expect(isValidGtin('asin', 'B00X4WHP5!')).toBe(false)
  })

  it('accepts free-text MPN within the length cap', () => {
    expect(isValidGtin('mpn', 'AB-1234/c')).toBe(true)
    expect(isValidGtin('mpn', 'x'.repeat(71))).toBe(false)
    expect(isValidGtin('mpn', '')).toBe(false)
  })
})
