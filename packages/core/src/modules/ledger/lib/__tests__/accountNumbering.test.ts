// Unit tests for the PL numbering rules (PR #6340 review, items 3 and 4).
import { accountNumberFitsType, checkTypeNumber } from '../accountNumbering'

const pl = (code: string) => ({ jurisdiction: 'PL', code })

describe('checkTypeNumber', () => {
  it('accepts a three-digit number whose first digit is the group code', () => {
    expect(checkTypeNumber('402', pl('4'))).toBeNull()
    expect(checkTypeNumber('010', pl('0'))).toBeNull()
  })

  it('rejects a number with the wrong first digit', () => {
    expect(checkTypeNumber('499', pl('2'))).toBe('groupDigit')
  })

  it('rejects a number that is not exactly three digits', () => {
    expect(checkTypeNumber('49', pl('4'))).toBe('format')
    expect(checkTypeNumber('4021', pl('4'))).toBe('format')
    expect(checkTypeNumber('4a2', pl('4'))).toBe('format')
  })

  it('does not apply without a group or in a non-PL group', () => {
    expect(checkTypeNumber('anything', null)).toBeNull()
    expect(checkTypeNumber('anything', undefined)).toBeNull()
    expect(checkTypeNumber('anything', { jurisdiction: 'DE', code: '1' })).toBeNull()
  })
})

describe('accountNumberFitsType', () => {
  it('accepts a number that starts with its type number', () => {
    expect(accountNumberFitsType('402-1', '402', pl('4'))).toBe(true)
    expect(accountNumberFitsType('402', '402', pl('4'))).toBe(true)
  })

  it('rejects a number that does not start with its type number', () => {
    expect(accountNumberFitsType('403-1', '402', pl('4'))).toBe(false)
  })

  it('does not apply without a PL group', () => {
    expect(accountNumberFitsType('cash', '402', null)).toBe(true)
    expect(accountNumberFitsType('cash', '402', { jurisdiction: 'DE', code: '4' })).toBe(true)
  })
})
