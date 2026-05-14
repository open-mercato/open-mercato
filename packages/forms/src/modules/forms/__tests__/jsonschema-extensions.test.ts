import Ajv from 'ajv'
import {
  OM_FIELD_KEYWORDS,
  OM_FIELD_VALIDATORS,
  OM_ROOT_KEYWORDS,
  OM_ROOT_VALIDATORS,
  addOmKeywords,
  validateOmCrossKeyword,
} from '../schema/jsonschema-extensions'

describe('OM extension validators', () => {
  it('rejects x-om-type that is not a string', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.type](42)).toMatch(/must be a non-empty string/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.type]('text')).toBeNull()
  })

  it('rejects x-om-editable-by that is not an array of strings', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.editableBy]('admin')).toMatch(/array of role identifiers/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.editableBy](['admin', 7])).toMatch(/array of role identifiers/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.editableBy](['admin', 'patient'])).toBeNull()
  })

  it('rejects x-om-roles that is not an array of strings', () => {
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.roles]('admin')).toMatch(/array of role identifiers/)
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.roles]([])).toBeNull()
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.roles](['admin', 'patient'])).toBeNull()
  })

  it('rejects malformed x-om-sections entries', () => {
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]('not-an-array')).toMatch(/array of section descriptors/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([{ key: 1, title: { en: 'A' }, fieldKeys: [] }]),
    ).toMatch(/string `key`/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([{ key: 'a', title: 'oops', fieldKeys: [] }]),
    ).toMatch(/localized `title`/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([{ key: 'a', title: { en: 'A' }, fieldKeys: [1] }]),
    ).toMatch(/string array `fieldKeys`/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([
        { key: 'a', title: { en: 'A' }, fieldKeys: ['q1', 'q2'] },
      ]),
    ).toBeNull()
  })

  it('rejects malformed x-om-options', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.options]('not-array')).toMatch(/array of/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.options]([{ value: 1, label: { en: 'A' } }]),
    ).toMatch(/string `value`/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.options]([{ value: 'a', label: 'oops' }]),
    ).toMatch(/localized `label`/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.options]([{ value: 'a', label: { en: 'A' } }]),
    ).toBeNull()
  })

  it('accepts boolean for x-om-sensitive only', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.sensitive](true)).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.sensitive](false)).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.sensitive]('true')).toMatch(/boolean/)
  })
})

describe('reactive-core validators', () => {
  it('rejects malformed x-om-jumps', () => {
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.jumps]('nope')).toMatch(/array of jump rules/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.jumps]([{ from: { type: 'page' }, rules: [] }]),
    ).toMatch(/from.pageKey/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.jumps]([
        { from: { type: 'page', pageKey: 'a' }, rules: [{ if: true, goto: { type: 'page' } }] },
      ]),
    ).toMatch(/goto/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.jumps]([
        {
          from: { type: 'page', pageKey: 'a' },
          rules: [{ if: true, goto: { type: 'ending', endingKey: 'thanks' } }],
          otherwise: { type: 'next' },
        },
      ]),
    ).toBeNull()
  })

  it('rejects malformed x-om-variables', () => {
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.variables]('nope')).toMatch(/array/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.variables]([{ name: 'A_BAD_NAME', type: 'number', formula: 1 }]),
    ).toMatch(/name/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.variables]([{ name: 'ok', type: 'number' }]),
    ).toMatch(/formula/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.variables]([
        { name: 'ok', type: 'number', formula: { '+': [1, 1] } },
      ]),
    ).toBeNull()
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.variables]([
        { name: 'a', type: 'number', formula: { '+': [1, 1] } },
        { name: 'a', type: 'number', formula: { '+': [1, 1] } },
      ]),
    ).toMatch(/Duplicate/)
  })

  it('rejects malformed x-om-hidden-fields', () => {
    expect(OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.hiddenFields]('nope')).toMatch(/array/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.hiddenFields]([{ name: 'Bad-Name' }]),
    ).toMatch(/name/)
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.hiddenFields]([{ name: 'patient_id' }]),
    ).toBeNull()
  })

  it('accepts kind=ending and rejects redirect-url on non-endings', () => {
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([
        { key: 'thanks', kind: 'ending', title: { en: 'Thanks' }, fieldKeys: [], 'x-om-redirect-url': 'https://example.com' },
      ]),
    ).toBeNull()
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([
        { key: 'p1', kind: 'page', title: { en: 'P1' }, fieldKeys: [], 'x-om-redirect-url': 'https://example.com' },
      ]),
    ).toMatch(/redirect-url/)
  })

  it('rejects visibility-if on ending sections', () => {
    expect(
      OM_ROOT_VALIDATORS[OM_ROOT_KEYWORDS.sections]([
        { key: 'thanks', kind: 'ending', title: { en: 'T' }, fieldKeys: [], 'x-om-visibility-if': { '==': [1, 1] } },
      ]),
    ).toMatch(/visibility-if/)
  })
})

describe('validateOmCrossKeyword', () => {
  it('rejects hidden-field name collisions with property keys', () => {
    expect(
      validateOmCrossKeyword({
        properties: { patient_id: { type: 'string' } },
        'x-om-hidden-fields': [{ name: 'patient_id' }],
      } as any),
    ).toMatch(/collides with a field key/)
  })

  it('rejects variable name collisions with hidden-field names', () => {
    expect(
      validateOmCrossKeyword({
        properties: {},
        'x-om-hidden-fields': [{ name: 'patient_id' }],
        'x-om-variables': [{ name: 'patient_id', type: 'string', formula: '' }],
      } as any),
    ).toMatch(/collides with a hidden field/)
  })

  it('rejects jump rules referencing missing pages', () => {
    expect(
      validateOmCrossKeyword({
        properties: {},
        'x-om-sections': [{ key: 'p1', kind: 'page', title: { en: 'P1' }, fieldKeys: [] }],
        'x-om-jumps': [
          {
            from: { type: 'page', pageKey: 'ghost' },
            rules: [{ if: true, goto: { type: 'next' } }],
          },
        ],
      } as any),
    ).toMatch(/missing page/)
  })

  it('rejects jump goto targets referencing missing endings', () => {
    expect(
      validateOmCrossKeyword({
        properties: {},
        'x-om-sections': [{ key: 'p1', kind: 'page', title: { en: 'P1' }, fieldKeys: [] }],
        'x-om-jumps': [
          {
            from: { type: 'page', pageKey: 'p1' },
            rules: [{ if: true, goto: { type: 'ending', endingKey: 'ghost' } }],
          },
        ],
      } as any),
    ).toMatch(/missing ending/)
  })

  it('rejects formulas with operators outside the grammar', () => {
    expect(
      validateOmCrossKeyword({
        properties: {},
        'x-om-variables': [{ name: 'total', type: 'number', formula: { map: [[1], { '+': [1, 1] }] } }],
      } as any),
    ).toMatch(/not allowed/)
  })

  it('returns null for a consistent schema', () => {
    expect(
      validateOmCrossKeyword({
        properties: { age: { type: 'number' } },
        'x-om-sections': [
          { key: 'p1', kind: 'page', title: { en: 'P1' }, fieldKeys: ['age'] },
          { key: 'thanks', kind: 'ending', title: { en: 'Thanks' }, fieldKeys: [] },
        ],
        'x-om-hidden-fields': [{ name: 'patient_id' }],
        'x-om-variables': [
          { name: 'total', type: 'number', formula: { '+': [{ var: 'age' }, 1] } },
        ],
        'x-om-jumps': [
          {
            from: { type: 'page', pageKey: 'p1' },
            rules: [{ if: { '>': [{ var: 'var.total' }, 18] }, goto: { type: 'ending', endingKey: 'thanks' } }],
          },
        ],
      } as any),
    ).toBeNull()
  })
})

describe('addOmKeywords', () => {
  it('lets AJV compile schemas decorated with x-om-* keywords', () => {
    const ajv = new Ajv({ strict: false })
    addOmKeywords(ajv)
    const schema = {
      type: 'object',
      'x-om-roles': ['admin', 'patient'],
      properties: {
        full_name: {
          type: 'string',
          'x-om-type': 'text',
          'x-om-label': { en: 'Full name' },
          'x-om-editable-by': ['patient'],
          'x-om-visible-to': ['admin', 'patient'],
        },
      },
      required: ['full_name'],
    }
    expect(() => ajv.compile(schema)).not.toThrow()
  })

  it('is idempotent — calling twice does not throw', () => {
    const ajv = new Ajv({ strict: false })
    addOmKeywords(ajv)
    expect(() => addOmKeywords(ajv)).not.toThrow()
  })
})
