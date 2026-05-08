import Ajv from 'ajv'
import {
  OM_FIELD_KEYWORDS,
  OM_FIELD_VALIDATORS,
  OM_ROOT_KEYWORDS,
  OM_ROOT_VALIDATORS,
  addOmKeywords,
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
