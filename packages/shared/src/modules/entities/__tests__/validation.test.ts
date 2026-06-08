/** @jest-environment node */
import {
  MAX_CUSTOM_FIELD_KEYS_PER_RECORD,
  MAX_CUSTOM_FIELD_REGEX_PATTERN_LENGTH,
  MAX_CUSTOM_FIELD_REGEX_INPUT_LENGTH,
  TOO_MANY_CUSTOM_FIELDS_ERROR,
  UNKNOWN_CUSTOM_FIELD_ERROR,
  validateValuesAgainstDefs,
} from '../validation'

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

  it('evaluates dangerous backtracking regex rules in bounded time', () => {
    const defs = [
      {
        key: 'eu_vat_number',
        kind: 'text',
        configJson: {
          validation: [
            {
              rule: 'regex',
              param: '^(GB|FR|DE|IT|ES|PL|NL|BE|SE|AT|DK|FI|PT|IE|GR|CZ|RO|HU|SK|BG|HR|SI|LT|LV|EE|LU|MT|CY)?([0-9A-Za-z]+)*$',
              message: 'bad vat',
            },
          ],
        },
      },
    ]

    const startedAt = Date.now()
    const result = validateValuesAgainstDefs(
      { eu_vat_number: `${'A'.repeat(64)}!` },
      defs as any,
    )

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(result.ok).toBe(false)
    expect(result.fieldErrors['cf_eu_vat_number']).toBe('bad vat')
  })

  it('fails closed for unsupported regex syntax', () => {
    const defs = [
      {
        key: 'code',
        kind: 'text',
        configJson: {
          validation: [
            { rule: 'regex', param: '(?=safe)safe', message: 'unsupported regex' },
          ],
        },
      },
    ]

    const result = validateValuesAgainstDefs({ code: 'safe' }, defs as any)

    expect(result.ok).toBe(false)
    expect(result.fieldErrors['cf_code']).toBe('unsupported regex')
  })

  it('fails closed before testing oversized regex input values', () => {
    const defs = [
      {
        key: 'body',
        kind: 'multiline',
        configJson: {
          validation: [
            { rule: 'regex', param: '^a+$', message: 'body too large' },
          ],
        },
      },
    ]

    const result = validateValuesAgainstDefs(
      { body: 'a'.repeat(MAX_CUSTOM_FIELD_REGEX_INPUT_LENGTH + 1) },
      defs as any,
    )

    expect(result.ok).toBe(false)
    expect(result.fieldErrors['cf_body']).toBe('body too large')
  })

  it('rejects values for undeclared keys only when rejectUndeclaredKeys is set', () => {
    const defs = [{ key: 'priority', kind: 'integer', configJson: {} }]
    const strict = validateValuesAgainstDefs({ priority: 1, undeclared: 'x' }, defs as any, {
      rejectUndeclaredKeys: true,
    })

    expect(strict.ok).toBe(false)
    expect(strict.fieldErrors.cf_undeclared).toBe(UNKNOWN_CUSTOM_FIELD_ERROR)
  })

  it('persists undeclared keys by default (trusted command writes)', () => {
    const defs = [{ key: 'priority', kind: 'integer', configJson: {} }]
    const result = validateValuesAgainstDefs({ priority: 1, undeclared: 'x' }, defs as any)

    expect(result.ok).toBe(true)
  })

  it('ignores undefined keys even in strict mode', () => {
    const defs = [{ key: 'priority', kind: 'integer', configJson: {} }]
    const result = validateValuesAgainstDefs({ priority: 1, undeclared: undefined }, defs as any, {
      rejectUndeclaredKeys: true,
    })

    expect(result.ok).toBe(true)
  })

  it('rejects payloads with too many custom field keys', () => {
    const values: Record<string, number> = {}
    for (let index = 0; index < MAX_CUSTOM_FIELD_KEYS_PER_RECORD + 1; index++) {
      values[`field_${index}`] = index
    }

    const defs = Object.keys(values).map((key) => ({ key, kind: 'integer', configJson: {} }))
    const result = validateValuesAgainstDefs(values, defs as any)

    expect(result.ok).toBe(false)
    expect(result.fieldErrors._customFields).toBe(TOO_MANY_CUSTOM_FIELDS_ERROR)
  })

  it('fails closed before testing oversized regex patterns', () => {
    const defs = [
      {
        key: 'code',
        kind: 'text',
        configJson: {
          validation: [
            {
              rule: 'regex',
              param: `^${'a'.repeat(MAX_CUSTOM_FIELD_REGEX_PATTERN_LENGTH)}$`,
              message: 'pattern too large',
            },
          ],
        },
      },
    ]

    const result = validateValuesAgainstDefs({ code: 'a' }, defs as any)

    expect(result.ok).toBe(false)
    expect(result.fieldErrors['cf_code']).toBe('pattern too large')
  })
})
