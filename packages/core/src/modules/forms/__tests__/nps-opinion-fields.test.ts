/**
 * Phase D end-to-end-ish tests for the NPS and Opinion-scale field types
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Asserts the full Phase D loop:
 * - `addFieldFromPalette({ typeKey: 'nps' })` produces a clean integer field.
 * - `setFieldNpsAnchors(...)` writes / clears anchor entries and a full
 *   set+clear cycle returns the schema byte-identical to its origin.
 * - Variables referencing an NPS field key compile cleanly through
 *   `validateSchemaExtensions` (variables formula round-trip — Phase D
 *   integration with reactive-core).
 */

import {
  addFieldFromPalette,
  setFieldNpsAnchors,
  setFieldOpinionIcon,
  setVariables,
  validateSchemaExtensions,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'

function blankSchema(): FormSchema {
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

describe('nps-opinion-fields — Phase D integration', () => {
  it('adds a clean NPS field via the palette helper', () => {
    const { schema, fieldKey } = addFieldFromPalette({
      schema: blankSchema(),
      typeKey: 'nps',
      target: { sectionKey: 'default_section' },
    })
    const node = schema.properties[fieldKey]
    expect(node['x-om-type']).toBe('nps')
    expect(node.type).toBe('integer')
    expect(node['x-om-label']).toEqual({ en: 'New field' })
    expect(node['x-om-nps-anchors']).toBeUndefined()
  })

  it('adds a clean opinion_scale field via the palette helper', () => {
    const { schema, fieldKey } = addFieldFromPalette({
      schema: blankSchema(),
      typeKey: 'opinion_scale',
      target: { sectionKey: 'default_section' },
    })
    const node = schema.properties[fieldKey]
    expect(node['x-om-type']).toBe('opinion_scale')
    expect(node.type).toBe('integer')
    expect(node['x-om-opinion-icon']).toBeUndefined()
  })

  it('round-trips setFieldNpsAnchors set + clear to byte-identical bytes', () => {
    const { schema: seeded, fieldKey } = addFieldFromPalette({
      schema: blankSchema(),
      typeKey: 'nps',
      target: { sectionKey: 'default_section' },
    })
    const seededJson = JSON.stringify(seeded)
    let schema: FormSchema = setFieldNpsAnchors({
      schema: seeded,
      fieldKey,
      locale: 'en',
      anchor: 'low',
      label: 'Hate',
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey,
      locale: 'en',
      anchor: 'high',
      label: 'Love',
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey,
      locale: 'en',
      anchor: 'low',
      label: null,
    })
    schema = setFieldNpsAnchors({
      schema,
      fieldKey,
      locale: 'en',
      anchor: 'high',
      label: null,
    })
    expect(JSON.stringify(schema)).toBe(seededJson)
  })

  it('round-trips setFieldOpinionIcon set + clear to byte-identical bytes', () => {
    const { schema: seeded, fieldKey } = addFieldFromPalette({
      schema: blankSchema(),
      typeKey: 'opinion_scale',
      target: { sectionKey: 'default_section' },
    })
    const seededJson = JSON.stringify(seeded)
    const withIcon = setFieldOpinionIcon({ schema: seeded, fieldKey, icon: 'star' })
    const cleared = setFieldOpinionIcon({ schema: withIcon, fieldKey, icon: 'dot' })
    expect(JSON.stringify(cleared)).toBe(seededJson)
  })

  it('compiles a form with variables that reference an nps field key', () => {
    const { schema, fieldKey } = addFieldFromPalette({
      schema: blankSchema(),
      typeKey: 'nps',
      target: { sectionKey: 'default_section' },
    })
    const withVariables = setVariables({
      schema,
      entries: [
        {
          name: 'nps_score',
          type: 'number',
          formula: { var: fieldKey },
        },
      ],
    })
    expect(() => validateSchemaExtensions(withVariables)).not.toThrow()
  })
})
