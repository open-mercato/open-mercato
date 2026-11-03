import { sliceFormDefinition } from '../lib/form-definition-slicing'

describe('sliceFormDefinition', () => {
  it('removes hidden fields from the schema, sections, requirements, and UI schema', () => {
    const result = sliceFormDefinition(
      {
        type: 'object',
        properties: {
          visible: { type: 'string', 'x-om-label': { en: 'Visible' } },
          secret: { type: 'string', 'x-om-label': { en: 'Secret diagnosis' } },
        },
        required: ['visible', 'secret'],
        'x-om-sections': [
          { key: 'main', fieldKeys: ['visible', 'secret'] },
          { key: 'secret-only', fieldKeys: ['secret'] },
        ],
      },
      {
        visible: { 'ui:widget': 'text' },
        secret: { 'ui:widget': 'textarea' },
        'ui:order': ['visible', 'secret', '*'],
        'ui:submitButtonOptions': { norender: true },
      },
      new Set(['visible']),
    )

    expect(result.schema.properties).toEqual({
      visible: { type: 'string', 'x-om-label': { en: 'Visible' } },
    })
    expect(result.schema.required).toEqual(['visible'])
    expect(result.schema['x-om-sections']).toEqual([{ key: 'main', fieldKeys: ['visible'] }])
    expect(result.uiSchema).toEqual({
      visible: { 'ui:widget': 'text' },
      'ui:order': ['visible', '*'],
      'ui:submitButtonOptions': { norender: true },
    })
  })
})
