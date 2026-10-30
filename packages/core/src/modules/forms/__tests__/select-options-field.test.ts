import {
  addFieldFromPalette,
  type FormSchema,
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
        fieldKeys: [],
      },
    ],
    properties: {},
    required: [],
  } as FormSchema
}

describe('addFieldFromPalette — select options', () => {
  it('seeds select_one with an empty options array', () => {
    const result = addFieldFromPalette({
      schema: buildSchema(),
      typeKey: 'select_one',
      target: { sectionKey: 'default_section' },
    })

    const node = result.schema.properties[result.fieldKey]
    expect(node.type).toBe('string')
    expect(node['x-om-type']).toBe('select_one')
    expect(node['x-om-options']).toEqual([])
  })

  it('seeds select_many with string array items and an empty options array', () => {
    const result = addFieldFromPalette({
      schema: buildSchema(),
      typeKey: 'select_many',
      target: { sectionKey: 'default_section' },
    })

    const node = result.schema.properties[result.fieldKey]
    expect(node.type).toBe('array')
    expect(node.items).toEqual({ type: 'string' })
    expect(node['x-om-type']).toBe('select_many')
    expect(node['x-om-options']).toEqual([])
  })
})
