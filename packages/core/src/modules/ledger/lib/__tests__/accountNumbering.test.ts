// Unit tests for the PL numbering rules (PR #6340 review, items 3 and 4).
import { accountNumberFitsType, checkTypeNumber, planAccountRenumber, reprefixNumber } from '../accountNumbering'

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

describe('reprefixNumber', () => {
  it('keeps an edit form value that already carries the prefix once it loads (406 stays 406, not 4406)', () => {
    expect(reprefixNumber('406', null, '4')).toBe('406')
    expect(reprefixNumber('402-01', null, '402')).toBe('402-01')
  })

  it('prefixes an empty or unprefixed value when the prefix first becomes known', () => {
    expect(reprefixNumber('', null, '4')).toBe('4')
    expect(reprefixNumber('06', null, '4')).toBe('406')
  })

  it('swaps the prefix and keeps the typed ending', () => {
    expect(reprefixNumber('406', '4', '5')).toBe('506')
    expect(reprefixNumber('402-01', '402', '403')).toBe('403-01')
  })

  it('drops the prefix when the group or type is cleared', () => {
    expect(reprefixNumber('406', '4', null)).toBe('06')
    expect(reprefixNumber('free text', null, null)).toBe('free text')
  })

  it('changes nothing when the prefix did not change', () => {
    expect(reprefixNumber('406', '4', '4')).toBe('406')
  })
})

describe('planAccountRenumber', () => {
  it('swaps the old type prefix for the new one', () => {
    const plan = planAccountRenumber([{ id: 'a', number: '402-01' }, { id: 'b', number: '402' }], '402', '412')
    expect(plan.renames).toEqual([
      { id: 'a', from: '402-01', to: '412-01' },
      { id: 'b', from: '402', to: '412' },
    ])
    expect(plan.unfixable).toEqual([])
  })

  it('leaves an account that already starts with the new number', () => {
    const plan = planAccountRenumber([{ id: 'a', number: '412-01' }], '402', '412')
    expect(plan.renames).toEqual([])
    expect(plan.unfixable).toEqual([])
  })

  it('reports an account that fits neither number', () => {
    const plan = planAccountRenumber([{ id: 'a', number: '999-01' }, { id: 'b', number: '402-02' }], '402', '412')
    expect(plan.unfixable).toEqual(['a'])
    expect(plan.renames).toEqual([{ id: 'b', from: '402-02', to: '412-02' }])
  })
})
