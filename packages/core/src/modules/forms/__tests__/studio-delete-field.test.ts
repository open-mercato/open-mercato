import {
  addFieldFromPalette,
  addLayoutFromPalette,
  deleteField,
  SchemaHelperError,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'

describe('studio deleteField', () => {
  it('removes the field node, required entry, and section references', () => {
    const base: FormSchema = { type: 'object', properties: {} }
    const withSection = addLayoutFromPalette({ schema: base, kind: 'section' }).schema
    const sectionKey = withSection['x-om-sections']?.[0]?.key
    expect(sectionKey).toBeDefined()

    const seeded = addFieldFromPalette({
      schema: withSection,
      typeKey: 'text',
      target: { sectionKey: sectionKey! },
    })
    const schemaWithRequired: FormSchema = {
      ...seeded.schema,
      required: [seeded.fieldKey],
    }

    const result = deleteField({
      schema: schemaWithRequired,
      fieldKey: seeded.fieldKey,
    })

    expect(result.properties[seeded.fieldKey]).toBeUndefined()
    expect(result.required).not.toContain(seeded.fieldKey)
    expect(result['x-om-sections']?.[0]?.fieldKeys).not.toContain(seeded.fieldKey)
  })

  it('rejects unknown field keys', () => {
    const schema: FormSchema = { type: 'object', properties: {} }
    expect(() => deleteField({ schema, fieldKey: 'missing' })).toThrow(SchemaHelperError)
  })
})
