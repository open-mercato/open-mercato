/**
 * Phase A unit tests for the Tier-2 validation schema helpers
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Each helper is a pure mutation on the `FormSchema` view of an `x-om-*`
 * form definition. The tests verify:
 *
 * - Setting a value writes the expected `x-om-*` keyword.
 * - Clearing a value (null / empty string) removes the keyword so the
 *   persisted shape stays minimal (R-9 mitigation — verbatim round-trip
 *   preserves schema hash).
 * - Round-tripping the same value back to its default leaves the schema
 *   byte-identical to the original (`JSON.stringify` equality).
 * - Cross-keyword checks fire when needed (pattern/length on non-string
 *   fields, min > max).
 */

import {
  addMatrixColumn,
  addMatrixRow,
  removeMatrixRow,
  setFieldLengthRange,
  setFieldNpsAnchors,
  setFieldNumberRange,
  setFieldOpinionIcon,
  setFieldPattern,
  setFieldRankingExhaustive,
  setFieldValidationMessages,
  setMatrixColumns,
  setMatrixRows,
  type FormSchema,
  type OmMatrixColumnInput,
  type OmMatrixRowInput,
} from '../backend/forms/[id]/studio/schema-helpers'

function buildSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: ['name'],
      },
    ],
    properties: {
      name: {
        type: 'string',
        'x-om-type': 'text',
        'x-om-label': { en: 'Name' },
        'x-om-editable-by': ['admin'],
      },
    },
    required: [],
  } as FormSchema
}

function buildNumericSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: ['score'],
      },
    ],
    properties: {
      score: {
        type: 'number',
        'x-om-type': 'number',
        'x-om-label': { en: 'Score' },
        'x-om-editable-by': ['admin'],
      },
    },
    required: [],
  } as FormSchema
}

describe('setFieldPattern', () => {
  it('writes x-om-pattern when given a valid regex source', () => {
    const schema = buildSchema()
    const next = setFieldPattern({ schema, fieldKey: 'name', pattern: '^[a-z]+$' })
    expect(next.properties.name['x-om-pattern']).toBe('^[a-z]+$')
  })

  it('clears x-om-pattern when given null or empty string', () => {
    const base = buildSchema()
    const withPattern = setFieldPattern({ schema: base, fieldKey: 'name', pattern: '^a$' })
    const clearedByNull = setFieldPattern({ schema: withPattern, fieldKey: 'name', pattern: null })
    expect(clearedByNull.properties.name['x-om-pattern']).toBeUndefined()
    const clearedByEmpty = setFieldPattern({ schema: withPattern, fieldKey: 'name', pattern: '' })
    expect(clearedByEmpty.properties.name['x-om-pattern']).toBeUndefined()
  })

  it('throws on a malformed regex', () => {
    const schema = buildSchema()
    expect(() => setFieldPattern({ schema, fieldKey: 'name', pattern: '[' })).toThrow()
  })

  it('rejects pattern on a non-string field (cross-keyword)', () => {
    const schema = buildNumericSchema()
    expect(() => setFieldPattern({ schema, fieldKey: 'score', pattern: '^[0-9]+$' })).toThrow()
  })

  it('round-trip clear leaves the schema byte-identical to the original', () => {
    const original = buildSchema()
    const originalJson = JSON.stringify(original)
    const withPattern = setFieldPattern({ schema: original, fieldKey: 'name', pattern: '^a$' })
    const cleared = setFieldPattern({ schema: withPattern, fieldKey: 'name', pattern: null })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })
})

describe('setFieldLengthRange', () => {
  it('writes both bounds when provided', () => {
    const schema = buildSchema()
    const next = setFieldLengthRange({ schema, fieldKey: 'name', min: 3, max: 10 })
    expect(next.properties.name['x-om-min-length']).toBe(3)
    expect(next.properties.name['x-om-max-length']).toBe(10)
  })

  it('clears bounds when null is passed', () => {
    const base = buildSchema()
    const seeded = setFieldLengthRange({ schema: base, fieldKey: 'name', min: 1, max: 5 })
    const cleared = setFieldLengthRange({ schema: seeded, fieldKey: 'name', min: null, max: null })
    expect(cleared.properties.name['x-om-min-length']).toBeUndefined()
    expect(cleared.properties.name['x-om-max-length']).toBeUndefined()
  })

  it('refuses to persist min > max via the cross-keyword check', () => {
    const schema = buildSchema()
    expect(() =>
      setFieldLengthRange({ schema, fieldKey: 'name', min: 10, max: 3 }),
    ).toThrow()
  })

  it('round-trip clear leaves the schema byte-identical to the original', () => {
    const original = buildSchema()
    const originalJson = JSON.stringify(original)
    const seeded = setFieldLengthRange({ schema: original, fieldKey: 'name', min: 1, max: 4 })
    const cleared = setFieldLengthRange({
      schema: seeded,
      fieldKey: 'name',
      min: null,
      max: null,
    })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })
})

describe('setFieldNumberRange', () => {
  it('writes x-om-min and x-om-max', () => {
    const schema = buildNumericSchema()
    const next = setFieldNumberRange({ schema, fieldKey: 'score', min: 0, max: 100 })
    expect(next.properties.score['x-om-min']).toBe(0)
    expect(next.properties.score['x-om-max']).toBe(100)
  })

  it('clears bounds with null', () => {
    const seeded = setFieldNumberRange({
      schema: buildNumericSchema(),
      fieldKey: 'score',
      min: 0,
      max: 100,
    })
    const cleared = setFieldNumberRange({
      schema: seeded,
      fieldKey: 'score',
      min: null,
      max: null,
    })
    expect(cleared.properties.score['x-om-min']).toBeUndefined()
    expect(cleared.properties.score['x-om-max']).toBeUndefined()
  })

  it('round-trip clear leaves the numeric schema byte-identical to the original', () => {
    const original = buildNumericSchema()
    const originalJson = JSON.stringify(original)
    const seeded = setFieldNumberRange({ schema: original, fieldKey: 'score', min: 0, max: 10 })
    const cleared = setFieldNumberRange({
      schema: seeded,
      fieldKey: 'score',
      min: null,
      max: null,
    })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })
})

describe('setFieldValidationMessages', () => {
  it('writes a single entry under the active locale', () => {
    const schema = buildSchema()
    const next = setFieldValidationMessages({
      schema,
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: 'Please enter a valid SSN.',
    })
    expect(next.properties.name['x-om-validation-messages']).toEqual({
      en: { pattern: 'Please enter a valid SSN.' },
    })
  })

  it('removes the inner entry on empty message and drops empty inner / outer maps', () => {
    const seeded = setFieldValidationMessages({
      schema: buildSchema(),
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: 'Bad.',
    })
    const cleared = setFieldValidationMessages({
      schema: seeded,
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: null,
    })
    expect(cleared.properties.name['x-om-validation-messages']).toBeUndefined()
  })

  it('keeps other locale / rule entries intact when one leaf is cleared', () => {
    let schema: FormSchema = buildSchema()
    schema = setFieldValidationMessages({
      schema,
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: 'Pattern.',
    })
    schema = setFieldValidationMessages({
      schema,
      fieldKey: 'name',
      locale: 'en',
      rule: 'minLength',
      message: 'Too short.',
    })
    schema = setFieldValidationMessages({
      schema,
      fieldKey: 'name',
      locale: 'es',
      rule: 'pattern',
      message: 'Patrón.',
    })
    schema = setFieldValidationMessages({
      schema,
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: null,
    })
    expect(schema.properties.name['x-om-validation-messages']).toEqual({
      en: { minLength: 'Too short.' },
      es: { pattern: 'Patrón.' },
    })
  })

  it('round-trip clear leaves the schema byte-identical to the original', () => {
    const original = buildSchema()
    const originalJson = JSON.stringify(original)
    const seeded = setFieldValidationMessages({
      schema: original,
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: 'Bad.',
    })
    const cleared = setFieldValidationMessages({
      schema: seeded,
      fieldKey: 'name',
      locale: 'en',
      rule: 'pattern',
      message: null,
    })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })
})

function buildOpinionScaleSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: ['mood'],
      },
    ],
    properties: {
      mood: {
        type: 'integer',
        'x-om-type': 'opinion_scale',
        'x-om-label': { en: 'Mood' },
        'x-om-editable-by': ['admin'],
      },
    },
    required: [],
  } as FormSchema
}

function buildNpsSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: ['recommend'],
      },
    ],
    properties: {
      recommend: {
        type: 'integer',
        'x-om-type': 'nps',
        'x-om-label': { en: 'Recommend' },
        'x-om-editable-by': ['admin'],
      },
    },
    required: [],
  } as FormSchema
}

describe('setFieldOpinionIcon', () => {
  it('writes x-om-opinion-icon when given star or thumb', () => {
    const schema = buildOpinionScaleSchema()
    const next = setFieldOpinionIcon({ schema, fieldKey: 'mood', icon: 'star' })
    expect(next.properties.mood['x-om-opinion-icon']).toBe('star')
    const withThumb = setFieldOpinionIcon({ schema, fieldKey: 'mood', icon: 'thumb' })
    expect(withThumb.properties.mood['x-om-opinion-icon']).toBe('thumb')
  })

  it('clears the keyword when given the default `dot` or null', () => {
    const seeded = setFieldOpinionIcon({
      schema: buildOpinionScaleSchema(),
      fieldKey: 'mood',
      icon: 'star',
    })
    const clearedByDot = setFieldOpinionIcon({ schema: seeded, fieldKey: 'mood', icon: 'dot' })
    expect(clearedByDot.properties.mood['x-om-opinion-icon']).toBeUndefined()
    const clearedByNull = setFieldOpinionIcon({ schema: seeded, fieldKey: 'mood', icon: null })
    expect(clearedByNull.properties.mood['x-om-opinion-icon']).toBeUndefined()
  })

  it('round-trip set + clear leaves the schema byte-identical to the original', () => {
    const original = buildOpinionScaleSchema()
    const originalJson = JSON.stringify(original)
    const seeded = setFieldOpinionIcon({ schema: original, fieldKey: 'mood', icon: 'star' })
    const cleared = setFieldOpinionIcon({ schema: seeded, fieldKey: 'mood', icon: 'dot' })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })
})

function buildRankingSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: ['priorities'],
      },
    ],
    properties: {
      priorities: {
        type: 'array',
        items: { type: 'string' },
        'x-om-type': 'ranking',
        'x-om-label': { en: 'Priorities' },
        'x-om-editable-by': ['admin'],
        'x-om-options': [
          { value: 'a', label: { en: 'A' } },
          { value: 'b', label: { en: 'B' } },
          { value: 'c', label: { en: 'C' } },
        ],
      },
    },
    required: [],
  } as FormSchema
}

describe('setFieldRankingExhaustive', () => {
  it('writes x-om-ranking-exhaustive when value is true', () => {
    const schema = buildRankingSchema()
    const next = setFieldRankingExhaustive({ schema, fieldKey: 'priorities', value: true })
    expect(next.properties.priorities['x-om-ranking-exhaustive']).toBe(true)
  })

  it('clears x-om-ranking-exhaustive when value is false', () => {
    const seeded = setFieldRankingExhaustive({
      schema: buildRankingSchema(),
      fieldKey: 'priorities',
      value: true,
    })
    const cleared = setFieldRankingExhaustive({
      schema: seeded,
      fieldKey: 'priorities',
      value: false,
    })
    expect(cleared.properties.priorities['x-om-ranking-exhaustive']).toBeUndefined()
  })

  it('round-trip set + clear leaves the schema byte-identical to the original', () => {
    const original = buildRankingSchema()
    const originalJson = JSON.stringify(original)
    const seeded = setFieldRankingExhaustive({
      schema: original,
      fieldKey: 'priorities',
      value: true,
    })
    const cleared = setFieldRankingExhaustive({
      schema: seeded,
      fieldKey: 'priorities',
      value: false,
    })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })

  it('rejects ranking-exhaustive on a non-ranking field via cross-keyword check', () => {
    const schema = buildSchema()
    expect(() =>
      setFieldRankingExhaustive({ schema, fieldKey: 'name', value: true }),
    ).toThrow()
  })
})

describe('setFieldNpsAnchors', () => {
  it('writes a single locale entry under the requested anchor', () => {
    const schema = buildNpsSchema()
    const next = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'low',
      label: 'Hate',
    })
    expect(next.properties.recommend['x-om-nps-anchors']).toEqual({
      low: { en: 'Hate' },
      high: {},
    })
  })

  it('clears one anchor entry when label is null and removes the keyword when both anchors empty', () => {
    let schema = buildNpsSchema()
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'low',
      label: 'Hate',
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'high',
      label: 'Love',
    })
    expect(schema.properties.recommend['x-om-nps-anchors']).toEqual({
      low: { en: 'Hate' },
      high: { en: 'Love' },
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'low',
      label: null,
    })
    expect(schema.properties.recommend['x-om-nps-anchors']).toEqual({
      low: {},
      high: { en: 'Love' },
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'high',
      label: null,
    })
    expect(schema.properties.recommend['x-om-nps-anchors']).toBeUndefined()
  })

  it('round-trip set + clear of both anchors leaves the schema byte-identical', () => {
    const original = buildNpsSchema()
    const originalJson = JSON.stringify(original)
    let schema = setFieldNpsAnchors({
      schema: original,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'low',
      label: 'Hate',
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'high',
      label: 'Love',
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'low',
      label: null,
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey: 'recommend',
      locale: 'en',
      anchor: 'high',
      label: null,
    })
    expect(JSON.stringify(schema)).toBe(originalJson)
  })
})

function buildMatrixSchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: ['grid'],
      },
    ],
    properties: {
      grid: {
        type: 'object',
        'x-om-type': 'matrix',
        'x-om-label': { en: 'Satisfaction' },
        'x-om-editable-by': ['admin'],
        additionalProperties: false,
      },
    },
    required: [],
  } as FormSchema
}

describe('setMatrixRows / setMatrixColumns', () => {
  it('writes the array verbatim when provided', () => {
    const rows: OmMatrixRowInput[] = [
      { key: 'communication', label: { en: 'Communication' } },
      { key: 'wait_time', label: { en: 'Wait time' }, required: true, multiple: true },
    ]
    const next = setMatrixRows({ schema: buildMatrixSchema(), fieldKey: 'grid', rows })
    expect(next.properties.grid['x-om-matrix-rows']).toEqual([
      { key: 'communication', label: { en: 'Communication' } },
      { key: 'wait_time', label: { en: 'Wait time' }, multiple: true, required: true },
    ])
  })

  it('clears the keyword when given an empty array (byte-identity round-trip)', () => {
    const original = buildMatrixSchema()
    const originalJson = JSON.stringify(original)
    const seeded = setMatrixRows({
      schema: original,
      fieldKey: 'grid',
      rows: [{ key: 'a', label: { en: 'A' } }],
    })
    const cleared = setMatrixRows({ schema: seeded, fieldKey: 'grid', rows: [] })
    expect(JSON.stringify(cleared)).toBe(originalJson)
  })

  it('writes columns and clears them on empty array', () => {
    const columns: OmMatrixColumnInput[] = [
      { value: 'agree', label: { en: 'Agree' } },
      { value: 'neutral', label: { en: 'Neutral' } },
    ]
    const next = setMatrixColumns({ schema: buildMatrixSchema(), fieldKey: 'grid', columns })
    expect(next.properties.grid['x-om-matrix-columns']).toHaveLength(2)
    const cleared = setMatrixColumns({ schema: next, fieldKey: 'grid', columns: [] })
    expect(cleared.properties.grid['x-om-matrix-columns']).toBeUndefined()
  })

  it('addMatrixRow appends a row and assigns the next `row_<n>` key', () => {
    let schema = buildMatrixSchema()
    schema = addMatrixRow({ schema, fieldKey: 'grid' })
    schema = addMatrixRow({ schema, fieldKey: 'grid' })
    const rows = schema.properties.grid['x-om-matrix-rows']!
    expect(rows.map((row) => row.key)).toEqual(['row_1', 'row_2'])
  })

  it('removeMatrixRow drops the entry for the given rowKey', () => {
    let schema = setMatrixRows({
      schema: buildMatrixSchema(),
      fieldKey: 'grid',
      rows: [
        { key: 'communication', label: { en: 'Communication' } },
        { key: 'wait_time', label: { en: 'Wait time' } },
      ],
    })
    schema = removeMatrixRow({ schema, fieldKey: 'grid', rowKey: 'communication' })
    const rows = schema.properties.grid['x-om-matrix-rows']!
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('wait_time')
  })

  it('addMatrixColumn appends a column and assigns the next `col_<n>` value', () => {
    let schema = buildMatrixSchema()
    schema = addMatrixColumn({ schema, fieldKey: 'grid' })
    schema = addMatrixColumn({ schema, fieldKey: 'grid' })
    const columns = schema.properties.grid['x-om-matrix-columns']!
    expect(columns.map((column) => column.value)).toEqual(['col_1', 'col_2'])
  })

  it('refuses matrix rows on a non-matrix field via cross-keyword check', () => {
    const baseSchema: FormSchema = {
      type: 'object',
      'x-om-roles': ['admin'],
      'x-om-default-actor-role': 'admin',
      'x-om-sections': [
        {
          key: 'default_section',
          kind: 'section',
          title: { en: '' },
          fieldKeys: ['name'],
        },
      ],
      properties: {
        name: {
          type: 'string',
          'x-om-type': 'text',
          'x-om-label': { en: 'Name' },
          'x-om-editable-by': ['admin'],
        },
      },
      required: [],
    } as FormSchema
    expect(() =>
      setMatrixRows({
        schema: baseSchema,
        fieldKey: 'name',
        rows: [{ key: 'a', label: { en: 'A' } }],
      }),
    ).toThrow()
  })
})
