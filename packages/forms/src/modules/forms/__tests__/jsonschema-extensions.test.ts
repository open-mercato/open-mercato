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

describe('Tier-2 validation extension keywords', () => {
  it('rejects x-om-pattern that is not a string or does not compile', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.pattern](42)).toMatch(/regex source string/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.pattern]('')).toMatch(/regex source string/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.pattern]('[')).toMatch(/regular expression/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.pattern]('^a$')).toBeNull()
  })

  it('rejects negative or non-integer length bounds', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.minLength](-1)).toMatch(/non-negative integer/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.minLength](1.5)).toMatch(/non-negative integer/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.minLength](0)).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.maxLength](-2)).toMatch(/non-negative integer/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.maxLength](32)).toBeNull()
  })

  it('rejects malformed x-om-validation-messages', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.validationMessages]('nope')).toMatch(/map/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.validationMessages]({ en: 'oops' }),
    ).toMatch(/\[rule\]: string/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.validationMessages]({ en: { bogusRule: 'msg' } }),
    ).toMatch(/not a recognized rule/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.validationMessages]({ en: { pattern: '' } }),
    ).toMatch(/non-empty string/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.validationMessages]({
        en: { pattern: 'Please enter a valid value.' },
        es: { minLength: 'Demasiado corto.' },
      }),
    ).toBeNull()
  })

  it('rejects pattern/length validation on non-string fields via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          score: { type: 'number', 'x-om-pattern': '^[0-9]+$' },
        },
      } as any),
    ).toMatch(/pattern\/length validation/)
    expect(
      validateOmCrossKeyword({
        properties: {
          score: { type: 'number', 'x-om-min-length': 3 },
        },
      } as any),
    ).toMatch(/pattern\/length validation/)
  })

  it('accepts known opinion-icon values, rejects others', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.opinionIcon]('star')).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.opinionIcon]('dot')).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.opinionIcon]('thumb')).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.opinionIcon]('cross')).toMatch(/star/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.opinionIcon](null)).toMatch(/star/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.opinionIcon](42)).toMatch(/star/)
  })

  it('accepts a well-formed x-om-nps-anchors, rejects malformed ones', () => {
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.npsAnchors]({
        low: { en: 'Hate' },
        high: { en: 'Love' },
      }),
    ).toBeNull()
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.npsAnchors]({ low: { en: 'Hate' } }),
    ).toMatch(/low.*high/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.npsAnchors]({
        low: 'oops',
        high: { en: 'Love' },
      }),
    ).toMatch(/low/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.npsAnchors]({
        low: { en: 'Hate' },
        high: { en: 42 },
      }),
    ).toMatch(/high/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.npsAnchors](null)).toMatch(/object/)
  })

  it('rejects x-om-opinion-icon on a non-opinion_scale field via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          mood: { type: 'integer', 'x-om-type': 'scale', 'x-om-opinion-icon': 'star' },
        },
      } as any),
    ).toMatch(/opinion-icon/)
    expect(
      validateOmCrossKeyword({
        properties: {
          mood: { type: 'integer', 'x-om-type': 'opinion_scale', 'x-om-opinion-icon': 'star' },
        },
      } as any),
    ).toBeNull()
  })

  it('rejects x-om-nps-anchors on a non-nps field via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          mood: {
            type: 'integer',
            'x-om-type': 'scale',
            'x-om-nps-anchors': { low: { en: 'Hate' }, high: { en: 'Love' } },
          },
        },
      } as any),
    ).toMatch(/nps-anchors/)
    expect(
      validateOmCrossKeyword({
        properties: {
          mood: {
            type: 'integer',
            'x-om-type': 'nps',
            'x-om-nps-anchors': { low: { en: 'Hate' }, high: { en: 'Love' } },
          },
        },
      } as any),
    ).toBeNull()
  })

  it('accepts boolean for x-om-ranking-exhaustive only', () => {
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.rankingExhaustive](true)).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.rankingExhaustive](false)).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.rankingExhaustive]('true')).toMatch(/boolean/)
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.rankingExhaustive](1)).toMatch(/boolean/)
  })

  it('rejects x-om-ranking-exhaustive on a non-ranking field via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          rank: {
            type: 'array',
            'x-om-type': 'select_many',
            'x-om-ranking-exhaustive': true,
          },
        },
      } as any),
    ).toMatch(/ranking-exhaustive/)
    expect(
      validateOmCrossKeyword({
        properties: {
          rank: {
            type: 'array',
            'x-om-type': 'ranking',
            'x-om-ranking-exhaustive': true,
          },
        },
      } as any),
    ).toBeNull()
  })

  it('accepts a well-formed x-om-matrix-rows array, rejects malformed entries', () => {
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixRows]([
        { key: 'communication', label: { en: 'Communication' } },
        { key: 'wait_time', label: { en: 'Wait time' }, multiple: true, required: true },
      ]),
    ).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixRows]('nope')).toMatch(/array/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixRows]([{ key: 'Bad-Key', label: { en: 'X' } }]),
    ).toMatch(/\^\[a-z\]/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixRows]([
        { key: 'a', label: { en: 'X' } },
        { key: 'a', label: { en: 'Y' } },
      ]),
    ).toMatch(/Duplicate matrix row key/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixRows]([
        { key: 'a', label: { en: 'X' }, multiple: 'yes' as unknown as boolean },
      ]),
    ).toMatch(/multiple/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixRows]([{ key: 'a', label: 'oops' }]),
    ).toMatch(/localized `label`/)
  })

  it('accepts a well-formed x-om-matrix-columns array, rejects malformed entries', () => {
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixColumns]([
        { value: 'agree', label: { en: 'Agree' } },
        { value: 'neutral', label: { en: 'Neutral' } },
      ]),
    ).toBeNull()
    expect(OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixColumns]('nope')).toMatch(/array/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixColumns]([
        { value: 'agree', label: { en: 'Agree' } },
        { value: 'agree', label: { en: 'Again' } },
      ]),
    ).toMatch(/Duplicate matrix column value/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixColumns]([{ value: '', label: { en: 'X' } }]),
    ).toMatch(/non-empty string `value`/)
    expect(
      OM_FIELD_VALIDATORS[OM_FIELD_KEYWORDS.matrixColumns]([{ value: 'agree' }]),
    ).toMatch(/localized `label`/)
  })

  it('rejects x-om-matrix-rows on a non-matrix field via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          grid: {
            type: 'object',
            'x-om-type': 'select_one',
            'x-om-matrix-rows': [{ key: 'communication', label: { en: 'Communication' } }],
          },
        },
      } as any),
    ).toMatch(/matrix-rows/)
    expect(
      validateOmCrossKeyword({
        properties: {
          grid: {
            type: 'object',
            'x-om-type': 'matrix',
            'x-om-matrix-rows': [{ key: 'communication', label: { en: 'Communication' } }],
          },
        },
      } as any),
    ).toBeNull()
  })

  it('rejects x-om-matrix-columns on a non-matrix field via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          grid: {
            type: 'object',
            'x-om-type': 'address',
            'x-om-matrix-columns': [{ value: 'agree', label: { en: 'Agree' } }],
          },
        },
      } as any),
    ).toMatch(/matrix-columns/)
  })

  it('R-3 soft cap: > 30 rows is rejected via cross-keyword check', () => {
    const rows = Array.from({ length: 31 }, (_, idx) => ({
      key: `row_${idx + 1}`,
      label: { en: `Row ${idx + 1}` },
    }))
    expect(
      validateOmCrossKeyword({
        properties: {
          grid: {
            type: 'object',
            'x-om-type': 'matrix',
            'x-om-matrix-rows': rows,
          },
        },
      } as any),
    ).toMatch(/too many rows/)
  })

  it('R-3 soft cap: > 10 columns is rejected via cross-keyword check', () => {
    const columns = Array.from({ length: 11 }, (_, idx) => ({
      value: `col_${idx + 1}`,
      label: { en: `Col ${idx + 1}` },
    }))
    expect(
      validateOmCrossKeyword({
        properties: {
          grid: {
            type: 'object',
            'x-om-type': 'matrix',
            'x-om-matrix-columns': columns,
          },
        },
      } as any),
    ).toMatch(/too many columns/)
  })

  it('rejects min-length > max-length via cross-keyword check', () => {
    expect(
      validateOmCrossKeyword({
        properties: {
          name: { type: 'string', 'x-om-min-length': 10, 'x-om-max-length': 5 },
        },
      } as any),
    ).toMatch(/must be <=/)
    expect(
      validateOmCrossKeyword({
        properties: {
          name: { type: 'string', 'x-om-min-length': 3, 'x-om-max-length': 10 },
        },
      } as any),
    ).toBeNull()
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
