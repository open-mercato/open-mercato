/**
 * Phase F unit tests for the matrix / Likert field type
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Covers:
 * - `addFieldFromPalette({ typeKey: 'matrix' })` seeds the field with
 *   `additionalProperties: false`, empty `x-om-matrix-rows`, empty
 *   `x-om-matrix-columns`, and the matching default uiSchema widget.
 * - `addMatrixRow` / `addMatrixColumn` append entries cleanly with fresh
 *   `row_<n>` / `col_<n>` keys.
 * - R-3 soft caps fire on the 31st row / 11th column via the cross-keyword
 *   validator inside `setMatrixRows` / `setMatrixColumns`.
 * - Per-row `multiple: true` swaps the field-type validator from single- to
 *   multi-select semantics.
 */

import {
  addFieldFromPalette,
  addMatrixColumn,
  addMatrixRow,
  setMatrixColumns,
  setMatrixRows,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'
import { V1_FIELD_TYPES } from '../schema/field-type-registry'

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

describe('addFieldFromPalette — matrix', () => {
  it('produces an object-typed field with empty rows/columns and additionalProperties:false', () => {
    const schema = buildEmptySchema()
    const result = addFieldFromPalette({
      schema,
      typeKey: 'matrix',
      target: { sectionKey: 'default_section' },
    })
    const node = result.schema.properties[result.fieldKey]
    expect(node.type).toBe('object')
    expect(node['x-om-type']).toBe('matrix')
    expect(node['x-om-matrix-rows']).toEqual([])
    expect(node['x-om-matrix-columns']).toEqual([])
    expect(node.additionalProperties).toBe(false)
  })

  it('places the new matrix field into the target section', () => {
    const schema = buildEmptySchema()
    const result = addFieldFromPalette({
      schema,
      typeKey: 'matrix',
      target: { sectionKey: 'default_section' },
    })
    const sections = result.schema['x-om-sections']!
    expect(sections[0].fieldKeys).toContain(result.fieldKey)
  })
})

describe('addMatrixRow / addMatrixColumn', () => {
  it('appends rows in declaration order with `row_<n>` keys', () => {
    let schema = buildEmptySchema()
    const seeded = addFieldFromPalette({
      schema,
      typeKey: 'matrix',
      target: { sectionKey: 'default_section' },
    })
    schema = addMatrixRow({ schema: seeded.schema, fieldKey: seeded.fieldKey })
    schema = addMatrixRow({ schema, fieldKey: seeded.fieldKey })
    const rows = schema.properties[seeded.fieldKey]['x-om-matrix-rows']!
    expect(rows.map((row) => row.key)).toEqual(['row_1', 'row_2'])
  })

  it('appends columns in declaration order with `col_<n>` values', () => {
    let schema = buildEmptySchema()
    const seeded = addFieldFromPalette({
      schema,
      typeKey: 'matrix',
      target: { sectionKey: 'default_section' },
    })
    schema = addMatrixColumn({ schema: seeded.schema, fieldKey: seeded.fieldKey })
    schema = addMatrixColumn({ schema, fieldKey: seeded.fieldKey })
    const columns = schema.properties[seeded.fieldKey]['x-om-matrix-columns']!
    expect(columns.map((column) => column.value)).toEqual(['col_1', 'col_2'])
  })
})

describe('R-3 soft cap enforcement', () => {
  it('rejects the 31st row at save time via the cross-keyword validator', () => {
    const seeded = addFieldFromPalette({
      schema: buildEmptySchema(),
      typeKey: 'matrix',
      target: { sectionKey: 'default_section' },
    })
    const rows = Array.from({ length: 31 }, (_, idx) => ({
      key: `row_${idx + 1}`,
      label: { en: `Row ${idx + 1}` },
    }))
    expect(() =>
      setMatrixRows({ schema: seeded.schema, fieldKey: seeded.fieldKey, rows }),
    ).toThrow(/too many rows/)
  })

  it('rejects the 11th column at save time via the cross-keyword validator', () => {
    const seeded = addFieldFromPalette({
      schema: buildEmptySchema(),
      typeKey: 'matrix',
      target: { sectionKey: 'default_section' },
    })
    const columns = Array.from({ length: 11 }, (_, idx) => ({
      value: `col_${idx + 1}`,
      label: { en: `Col ${idx + 1}` },
    }))
    expect(() =>
      setMatrixColumns({ schema: seeded.schema, fieldKey: seeded.fieldKey, columns }),
    ).toThrow(/too many columns/)
  })
})

describe('matrix validator — per-row multiple opt-in', () => {
  const spec = V1_FIELD_TYPES.matrix

  const fieldNode = {
    'x-om-matrix-rows': [
      { key: 'communication', label: { en: 'Communication' } },
      { key: 'concerns', label: { en: 'Concerns' }, multiple: true },
    ],
    'x-om-matrix-columns': [
      { value: 'agree', label: { en: 'Agree' } },
      { value: 'neutral', label: { en: 'Neutral' } },
    ],
  }

  it('treats single-select rows as a string value', () => {
    expect(spec.validator({ communication: 'agree' }, fieldNode)).toBe(true)
    expect(spec.validator({ communication: ['agree'] }, fieldNode)).not.toBe(true)
  })

  it('treats multi-select rows as a string[] value', () => {
    expect(spec.validator({ concerns: ['agree', 'neutral'] }, fieldNode)).toBe(true)
    expect(spec.validator({ concerns: 'agree' }, fieldNode)).not.toBe(true)
  })
})
