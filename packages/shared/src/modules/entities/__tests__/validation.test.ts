/** @jest-environment node */
import { validateValuesAgainstDefs } from '../validation'

describe('validateValuesAgainstDefs', () => {
  it('validates required and integer/float comparisons', () => {
    const defs = [
      { key: 'a', kind: 'integer', configJson: { validation: [ { rule: 'required', message: 'a required' }, { rule: 'integer', message: 'a int' }, { rule: 'gte', param: 1, message: 'a >= 1' } ] } },
      { key: 'b', kind: 'float', configJson: { validation: [ { rule: 'float', message: 'b float' }, { rule: 'lt', param: 10, message: 'b < 10' } ] } },
    ]

    // Empty a should fail required
    let r = validateValuesAgainstDefs({}, defs as any)
    expect(r.ok).toBe(false)
    expect(r.fieldErrors['cf_a']).toBe('a required')

    // Non-integer a should fail integer
    r = validateValuesAgainstDefs({ a: 1.2 }, defs as any)
    expect(r.ok).toBe(false)
    expect(r.fieldErrors['cf_a']).toBe('a int')

    // Too-small a should fail gte
    r = validateValuesAgainstDefs({ a: 0 }, defs as any)
    expect(r.ok).toBe(false)
    expect(r.fieldErrors['cf_a']).toBe('a >= 1')

    // b too large should fail lt
    r = validateValuesAgainstDefs({ a: 2, b: 11 }, defs as any)
    expect(r.ok).toBe(false)
    expect(r.fieldErrors['cf_b']).toBe('b < 10')

    // Both valid
    r = validateValuesAgainstDefs({ a: 2, b: 9.5 }, defs as any)
    expect(r.ok).toBe(true)
    expect(Object.keys(r.fieldErrors).length).toBe(0)
  })

  it('validates regex and eq/ne', () => {
    const defs = [
      { key: 'code', kind: 'text', configJson: { validation: [ { rule: 'regex', param: '^[a-z0-9_-]+$', message: 'bad code' } ] } },
      { key: 'status', kind: 'select', configJson: { validation: [ { rule: 'eq', param: 'open', message: 'must be open' } ] } },
    ]
    let r = validateValuesAgainstDefs({ code: 'Bad!' }, defs as any)
    expect(r.ok).toBe(false)
    expect(r.fieldErrors['cf_code']).toBe('bad code')
    r = validateValuesAgainstDefs({ code: 'ok', status: 'closed' }, defs as any)
    expect(r.ok).toBe(false)
    expect(r.fieldErrors['cf_status']).toBe('must be open')
    r = validateValuesAgainstDefs({ code: 'ok', status: 'open' }, defs as any)
    expect(r.ok).toBe(true)
  })
})

