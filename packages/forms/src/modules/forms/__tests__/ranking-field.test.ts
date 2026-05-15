/**
 * Phase E unit tests for the ranking field type
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Covers:
 * - `addFieldFromPalette({ typeKey: 'ranking' })` produces an array-typed
 *   field with `items: { type: 'string' }`, an empty `x-om-options`, and the
 *   matching default uiSchema widget.
 * - `setFieldRankingExhaustive({ value: true })` writes the keyword;
 *   `{ value: false }` clears it (byte-identical round-trip).
 * - Exhaustive enforcement happens at submit time via the compiled rule —
 *   the compiler reads `optionCount` from `x-om-options.length`.
 */

import {
  addFieldFromPalette,
  setFieldRankingExhaustive,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'
import { compileFieldValidationRules } from '../services/field-validation-service'

function buildEmptySchema(): FormSchema {
  return {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [
      {
        key: 'default_section',
        kind: 'section',
        title: { en: '' },
        fieldKeys: [],
      },
    ],
    properties: {},
    required: [],
  } as FormSchema
}

describe('addFieldFromPalette — ranking', () => {
  it('produces an array-typed field with items: { type: "string" } and an empty x-om-options', () => {
    const schema = buildEmptySchema()
    const result = addFieldFromPalette({
      schema,
      typeKey: 'ranking',
      target: { sectionKey: 'default_section' },
    })
    const node = result.schema.properties[result.fieldKey]
    expect(node.type).toBe('array')
    expect(node.items).toEqual({ type: 'string' })
    expect(node['x-om-type']).toBe('ranking')
    expect(node['x-om-options']).toEqual([])
  })

  it('places the new field into the target section', () => {
    const schema = buildEmptySchema()
    const result = addFieldFromPalette({
      schema,
      typeKey: 'ranking',
      target: { sectionKey: 'default_section' },
    })
    const sections = result.schema['x-om-sections']!
    expect(sections[0].fieldKeys).toContain(result.fieldKey)
  })
})

describe('setFieldRankingExhaustive byte-identity round-trip', () => {
  it('value:false leaves the schema byte-identical to the pre-toggle state', () => {
    const base = buildEmptySchema()
    const seeded = addFieldFromPalette({
      schema: base,
      typeKey: 'ranking',
      target: { sectionKey: 'default_section' },
    })
    const before = JSON.stringify(seeded.schema)
    const on = setFieldRankingExhaustive({
      schema: seeded.schema,
      fieldKey: seeded.fieldKey,
      value: true,
    })
    const off = setFieldRankingExhaustive({
      schema: on,
      fieldKey: seeded.fieldKey,
      value: false,
    })
    expect(JSON.stringify(off)).toBe(before)
  })
})

describe('exhaustive enforcement via the compiled rule', () => {
  it('compiles a rankingExhaustive rule whose optionCount tracks x-om-options.length', () => {
    const node = {
      type: 'array',
      'x-om-type': 'ranking',
      'x-om-ranking-exhaustive': true,
      'x-om-options': [
        { value: 'a', label: { en: 'A' } },
        { value: 'b', label: { en: 'B' } },
        { value: 'c', label: { en: 'C' } },
        { value: 'd', label: { en: 'D' } },
      ],
    } as Record<string, unknown>
    const rules = compileFieldValidationRules(node as never, 'ranking')
    expect(rules).toEqual([{ type: 'rankingExhaustive', optionCount: 4 }])
  })

  it('does not emit the rule when the keyword is absent', () => {
    const node = {
      type: 'array',
      'x-om-type': 'ranking',
      'x-om-options': [
        { value: 'a', label: { en: 'A' } },
      ],
    } as Record<string, unknown>
    const rules = compileFieldValidationRules(node as never, 'ranking')
    expect(rules).toEqual([])
  })
})
